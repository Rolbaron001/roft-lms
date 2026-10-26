import { EgressStatus, TrackSource } from "livekit-server-sdk";
import { recordPresence } from "@/lib/classroom";
import { mediaConfigured, receiveReport } from "@/lib/classroom-media";
import { microphoneStarted, recordingEnded } from "@/lib/classroom-record";

/**
 * The media server's reports of who joined a class and who left (job sheet
 * D41), which the register is filled in from. Signed with the media server's
 * secret; a report that is not is refused. Reached by the media server rather
 * than a person, so it belongs to no provider's address: the room's name says
 * whose class it was.
 */
export async function POST(request: Request) {
  if (!mediaConfigured()) return new Response("Not set up.", { status: 404 });

  const body = await request.text();
  let event;
  try {
    event = await receiveReport(body, request.headers.get("authorization"));
  } catch {
    return new Response("Not signed by the media server.", { status: 401 });
  }

  const room = event.room?.name ?? "";
  // Seconds since 1970, as the media server counts them.
  const at = event.createdAt ? new Date(Number(event.createdAt) * 1000) : new Date();
  const person = event.participant;

  switch (event.event) {
    case "participant_joined":
      if (person) await recordPresence({ event: "joined", room, identity: person.identity, connectionId: person.sid, at });
      break;
    case "participant_left":
    case "participant_connection_aborted":
      if (person) await recordPresence({ event: "left", room, identity: person.identity, connectionId: person.sid, at });
      break;
    case "room_finished":
      await recordPresence({ event: "room_finished", room, at });
      break;
    // Phase B: each microphone recorded for the transcript, and the class
    // sent to be transcribed once every recording has closed.
    case "track_published":
      if (person && event.track?.source === TrackSource.MICROPHONE) {
        await microphoneStarted({ room, identity: person.identity, trackId: event.track.sid, at }).catch((error: unknown) => {
          console.error("A class voice could not be recorded:", error);
        });
      }
      break;
    case "egress_ended":
      if (event.egressInfo) {
        await recordingEnded({
          egressId: event.egressInfo.egressId,
          // Nanoseconds since 1970, as the recorder counts them.
          at: event.egressInfo.endedAt ? new Date(Number(event.egressInfo.endedAt / BigInt(1_000_000))) : at,
          failed: event.egressInfo.status !== EgressStatus.EGRESS_COMPLETE,
        });
      }
      break;
  }
  return new Response("Received.");
}

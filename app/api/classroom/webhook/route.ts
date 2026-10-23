import { recordPresence } from "@/lib/classroom";
import { mediaConfigured, receiveReport } from "@/lib/classroom-media";

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
  }
  return new Response("Received.");
}

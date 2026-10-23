import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource, WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";

/**
 * The media server that carries a class's voice, cameras and shared screens
 * (job sheet D41): LiveKit, open source, run on the provider's own server so
 * no outside company carries the class. Everything that talks to it is here,
 * so replacing it later touches one file.
 *
 *   LIVEKIT_URL          where browsers connect, e.g. wss://class.example.org
 *   LIVEKIT_API_KEY      the key and secret the server is configured with
 *   LIVEKIT_API_SECRET
 *   LIVEKIT_API_URL      optional: where this server reaches it, if not the above
 *   LIVEKIT_ROOM_PREFIX  optional: keeps two sites sharing one media server apart
 *
 * Without the first three the classroom says it is not set up, and a session
 * can still be held at an outside meeting link.
 */

export function mediaConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

/** Where a browser connects. */
export function publicUrl(): string {
  return process.env.LIVEKIT_URL ?? "";
}

/** Where this server sends its instructions: the same host over HTTP unless told otherwise. */
function apiUrl(): string {
  return process.env.LIVEKIT_API_URL || publicUrl().replace(/^ws(s?):\/\//, "http$1://");
}

function prefix(): string {
  return (process.env.LIVEKIT_ROOM_PREFIX || "lms").replace(/[^a-z0-9]/gi, "");
}

/**
 * A class's room on the media server. It names the provider as well as the
 * session, so a report about a room is filed with the provider it belongs to
 * without trusting anything else in it. The prefix keeps the development site
 * and live apart when they share one media server, since a copy of live's
 * database carries live's identifiers.
 */
export function roomName(organisationId: string, sessionId: string): string {
  return `${prefix()}-${organisationId}-${sessionId}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

export function parseRoomName(room: string): { organisationId: string; sessionId: string } | null {
  const match = new RegExp(`^${prefix()}-(${UUID})-(${UUID})$`, "i").exec(room);
  return match ? { organisationId: match[1], sessionId: match[2] } : null;
}

/**
 * A pass into one room, for one person, valid long enough to connect. Everybody
 * may speak and type; a facilitator may also share a screen and run the room;
 * cameras only where the provider allows them.
 */
export async function issuePass(input: {
  room: string;
  identity: string;
  name: string;
  host: boolean;
  cameras: boolean;
  attributes: Record<string, string>;
}): Promise<string> {
  const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
    identity: input.identity,
    name: input.name,
    attributes: input.attributes,
    ttl: "10m",
  });
  const sources = [TrackSource.MICROPHONE];
  if (input.cameras) sources.push(TrackSource.CAMERA);
  if (input.host) sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  token.addGrant({
    room: input.room,
    roomJoin: true,
    roomAdmin: input.host,
    canPublish: true,
    canPublishSources: sources,
    canSubscribe: true,
    canPublishData: false,
    // A raised hand is the person's own attribute.
    canUpdateOwnMetadata: true,
  });
  return token.toJwt();
}

function rooms(): RoomServiceClient {
  return new RoomServiceClient(apiUrl(), process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
}

export async function muteTrack(room: string, identity: string, trackSid: string): Promise<void> {
  await rooms().mutePublishedTrack(room, identity, trackSid, true);
}

/** Every microphone in the room muted but the facilitator's own. */
export async function muteEveryoneBut(room: string, identity: string): Promise<void> {
  const service = rooms();
  for (const participant of await service.listParticipants(room)) {
    if (participant.identity === identity) continue;
    for (const track of participant.tracks) {
      if (track.source === TrackSource.MICROPHONE && !track.muted) {
        await service.mutePublishedTrack(room, participant.identity, track.sid, true);
      }
    }
  }
}

export async function removeParticipant(room: string, identity: string): Promise<void> {
  await rooms().removeParticipant(room, identity);
}

export async function setHand(room: string, identity: string, raised: boolean): Promise<void> {
  await rooms().updateParticipant(room, identity, { attributes: { hand: raised ? new Date().toISOString() : "" } });
}

/** A message to everybody in the room, on a named topic. */
export async function sendToRoom(room: string, topic: string, payload: unknown): Promise<void> {
  await rooms().sendData(room, new TextEncoder().encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, { topic });
}

/** Ends the room, letting everybody out. */
export async function closeRoom(room: string): Promise<void> {
  await rooms().deleteRoom(room);
}

/** A report from the media server, checked against the secret it was signed with. */
export async function receiveReport(body: string, authorization: string | null): Promise<WebhookEvent> {
  const receiver = new WebhookReceiver(process.env.LIVEKIT_API_KEY ?? "", process.env.LIVEKIT_API_SECRET ?? "");
  return receiver.receive(body, authorization ?? undefined);
}

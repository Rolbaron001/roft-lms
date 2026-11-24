/**
 * Study unit videos from YouTube (job sheet D46, 24 November 2026): a video
 * kept on the provider's own channel, added to the library by its link and
 * played in place, with no file stored here.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { withPlatformScope } from "@/db/client";
import { organisations, users } from "@/db/schema";
import { addYoutubeItem, listLibrary, readLibraryItem, removeLibraryItem } from "@/lib/library";
import { youtubeEmbedUrl, youtubeIdOf } from "@/lib/youtube";
import { permissionsFor, type Role } from "@/lib/rbac";
import type { AuthenticatedSession } from "@/lib/session";

describe("reading a YouTube link", () => {
  it("takes every form YouTube hands out", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=42s",
      "https://youtu.be/dQw4w9WgXcQ?si=abc",
      "youtu.be/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/live/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0",
    ]) {
      expect(youtubeIdOf(link), link).toBe("dQw4w9WgXcQ");
    }
  });

  it("refuses what is not one video on YouTube", () => {
    for (const link of [
      "https://vimeo.com/123456789",
      "https://www.youtube.com/@curiosa",
      "https://www.youtube.com/playlist?list=PL123",
      "https://www.youtube.com/watch?v=short",
      "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
      "not a link",
      "",
    ]) {
      expect(youtubeIdOf(link), link).toBeNull();
    }
  });

  it("plays in YouTube's privacy-enhanced player", () => {
    expect(youtubeEmbedUrl("dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0");
  });
});

let organisationId = "";
let userId = "";
const session = (): AuthenticatedSession => ({
  sessionId: "0",
  userId,
  organisationId,
  email: "author@youtube.test",
  firstName: "Author",
  lastName: "Test",
  roles: ["tenant_admin"] as Role[],
  permissions: permissionsFor({ roles: ["tenant_admin"] }),
  mustChangePassword: false,
  aiOn: false,
});

beforeAll(async () => {
  await withPlatformScope("YouTube material fixture: one provider to add a video link to", async (tx) => {
    const [org] = await tx
      .insert(organisations)
      .values({ slug: `youtube-${Date.now()}`, legalName: "YouTube test", displayName: "YouTube test", status: "active" })
      .returning({ id: organisations.id });
    organisationId = org.id;
    const [author] = await tx
      .insert(users)
      .values({ organisationId, email: "author@youtube.test", passwordHash: "not-used", firstName: "Author", lastName: "Test", status: "active" })
      .returning({ id: users.id });
    userId = author.id;
  });
});

afterAll(async () => {
  await withPlatformScope("YouTube material teardown", async (tx) => {
    await tx.delete(organisations).where(eq(organisations.id, organisationId));
  });
});

describe("a YouTube video in the library", () => {
  it("is kept by its identifier, as a video, with no file", async () => {
    const { id } = await addYoutubeItem(session(), { link: "https://youtu.be/dQw4w9WgXcQ", title: "Safety briefing" });
    const item = (await listLibrary(session())).find((one) => one.id === id);
    expect(item).toMatchObject({ title: "Safety briefing", kind: "video", youtubeId: "dQw4w9WgXcQ", sizeBytes: 0 });
    // Nothing to download: the video stays on YouTube.
    await expect(readLibraryItem(session(), id)).rejects.toThrow(/No file here/);
    await removeLibraryItem(session(), id);
  });

  it("refuses a link that is not to a YouTube video, and says where to find one", async () => {
    await expect(addYoutubeItem(session(), { link: "https://vimeo.com/123456789" })).rejects.toThrow(/Share button/);
  });
});

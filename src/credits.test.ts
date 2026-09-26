import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCredits } from "./credits";
import { SAMPLES } from "./samples";

const markdown = readFileSync(new URL("../public/samples/CREDITS.md", import.meta.url), "utf8");

describe("parseCredits", () => {
  const credits = parseCredits(markdown);

  it("has exactly one row per sample image", () => {
    expect(credits.map((c) => c.file).sort()).toEqual(SAMPLES.map((s) => `${s.id}.jpg`).sort());
  });

  it("parses linked sources and licenses", () => {
    expect(credits.find((c) => c.file === "cat.jpg")).toEqual({
      file: "cat.jpg",
      source: {
        text: "Black and white cat sitting on lawn.jpg",
        url: "https://commons.wikimedia.org/wiki/File:Black_and_white_cat_sitting_on_lawn.jpg",
      },
      author: "Grendelkhan",
      license: { text: "CC BY-SA 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0" },
    });
  });

  it("keeps parentheses inside URLs", () => {
    const child = credits.find((c) => c.file === "child.jpg")!;
    expect(child.source).toMatchObject({
      url: "https://commons.wikimedia.org/wiki/File:Boy_and_Ball_(8257295231).jpg",
    });
  });

  it("keeps plain-text cells as text", () => {
    expect(credits.find((c) => c.file === "bicycle.jpg")?.license).toBe("Public domain");
  });
});

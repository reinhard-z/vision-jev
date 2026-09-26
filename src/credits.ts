// Sample image attribution, read from public/samples/CREDITS.md so the file
// stays the single source for the repo and the app.

export interface Credit {
  file: string;
  /** Plain text when there is no link (e.g. an unconfirmed source). */
  source: Link | string;
  author: string;
  license: Link | string;
}

export interface Link {
  text: string;
  url: string;
}

/** Parse the credits table: `| file | [title](url) | author | [license](url) |`. */
export function parseCredits(markdown: string): Credit[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|") && !line.startsWith("| File") && !line.startsWith("| ---"))
    .map((line) => {
      const [file = "", source = "", author = "", license = ""] = line
        .slice(1, -1)
        .split("|")
        .map((cell) => cell.trim());
      return { file, source: link(source), author, license: link(license) };
    });
}

function link(cell: string): Link | string {
  const m = /^\[(.+?)\]\((.+)\)$/.exec(cell);
  return m ? { text: m[1]!, url: m[2]! } : cell;
}

export async function loadCredits(): Promise<Credit[]> {
  const res = await fetch("/samples/CREDITS.md");
  if (!res.ok) throw new Error(`credits returned ${res.status}`);
  return parseCredits(await res.text());
}

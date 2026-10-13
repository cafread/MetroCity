// Reads the country files from the GitHub repo and writes a set of them back as one commit.

export type Repo = { name: string; branch: string; token: string; fetch?: typeof fetch };

const api = (repo: Repo, path: string, init: RequestInit & { raw?: boolean } = {}) =>
    (repo.fetch ?? fetch)(`https://api.github.com/repos/${repo.name}/${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${repo.token}`,
            accept: init.raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
            "user-agent": "metrocity-editor",
            "x-github-api-version": "2022-11-28",
            ...(init.body ? { "content-type": "application/json" } : {}),
        },
    });

async function json(res: Response, what: string): Promise<Record<string, any>> {
    if (!res.ok) throw new Error(`GitHub ${what}: HTTP ${res.status}`);
    return res.json();
}

const path = (cc: string) => `data/cities/${cc}.ndjson`;

// The commit the branch points at
export async function head(repo: Repo): Promise<string> {
    return (await json(await api(repo, `git/ref/heads/${repo.branch}`), "branch")).object.sha;
}

// A country's file as it is at a commit, or null when it has none
export async function readCities(repo: Repo, commit: string, cc: string): Promise<string | null> {
    const res = await api(repo, `contents/${path(cc)}?ref=${commit}`, { raw: true });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub file ${cc}: HTTP ${res.status}`);
    return res.text();
}

// Writes the files as one commit on top of parent and moves the branch to it. A null file is deleted.
// Returns the new commit, or "" when the branch is no longer at parent, in which case nothing changed.
export async function commitCities(repo: Repo, parent: string, files: Record<string, string | null>, message: string, author: { name: string; email: string }): Promise<string> {
    const base = (await json(await api(repo, `git/commits/${parent}`), "commit")).tree.sha;
    const entries = Object.entries(files).map(([cc, text]) => (text === null ? { path: path(cc), mode: "100644", type: "blob", sha: null } : { path: path(cc), mode: "100644", type: "blob", content: text }));
    const tree = (await json(await api(repo, "git/trees", { method: "POST", body: JSON.stringify({ base_tree: base, tree: entries }) }), "tree")).sha;
    const commit = (await json(await api(repo, "git/commits", { method: "POST", body: JSON.stringify({ message, tree, parents: [parent], author }) }), "new commit")).sha;
    const moved = await api(repo, `git/refs/heads/${repo.branch}`, { method: "PATCH", body: JSON.stringify({ sha: commit, force: false }) });
    if (moved.status === 422) return "";
    await json(moved, "branch update");
    return commit;
}

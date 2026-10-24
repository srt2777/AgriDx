declare module 'virtual:agridx-version-history' {
  interface VersionRecord {
    id: string;
    version: string;
    date: string | null;
    draft: boolean;
    legacy: boolean;
    kind: string | null;
    summary: string | null;
    details: string;
    knowledge: string | null;
    compatibility: string | null;
    verification: string | null;
    deployment: string | null;
    prs: string[];
  }
  const history: { currentVersion: string; repository: string; releases: VersionRecord[] };
  export default history;
}


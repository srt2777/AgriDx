export function validateSite(directory: string, target: string, siteName: string): { site: { name: string; project_id: string }; manifest: Record<string, unknown> };
export function prepareSite(options: { directory?: string; target: string; siteName: string }): unknown;

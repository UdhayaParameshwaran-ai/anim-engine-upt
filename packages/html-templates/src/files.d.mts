export const TEMPLATE_ORIGIN: string;
export interface TemplateResponse { status: number; type: string; body: Buffer }
/** Answer for a request to the designer's pages (or their font), or null when the URL is not ours. */
export function respond(url: string): TemplateResponse | null;
/** Answer for a path under the template root (`/phase1/...`, `/_fonts.css`, `/_fonts/...`). */
export function respondPath(path: string): TemplateResponse;

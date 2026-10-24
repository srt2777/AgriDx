/** Public assets work at both the production origin and the development preview path. */
export const publicAsset = (file: string) => `${import.meta.env.BASE_URL}${file.replace(/^\/+/, '')}`;

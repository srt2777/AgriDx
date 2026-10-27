/// <reference types="vite/client" />

// GLB 模型文件模块声明
declare module '*.glb?url' {
  const src: string;
  export default src;
}

declare module '*.glb' {
  const src: string;
  export default src;
}

export {};

declare global {
  interface Window {
    agridxTheme: {
      getSnapshot: () => 'light' | 'dark';
      subscribe: (listener: () => void) => () => void;
      setTheme: (theme: 'light' | 'dark') => void;
    };
  }
  const __AGRIDX_DEV_PREVIEW__: boolean;
  const __AGRIDX_BUILD_COMMIT__: string;
  const __AGRIDX_GATEWAY_REQUIRED__: { minimumSchema: number; capabilities: string[]; sourceHash: string };
  const __AGRIDX_PREVIEW_RELEASE__: { version: string; commit: string; branch: string; repository: string; builtAt: string };
}

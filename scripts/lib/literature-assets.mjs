import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
/** Identical immutable shards for production and static development preview. */
export function literatureAssetsPlugin(root) {
  const directory = path.join(root, 'data/literature');
  const allowed = name => /^(manifest|journals|provenance)\.json$|^(records-\d{3,4}\.jsonl|terms-\d{3}\.json)\.gz$/.test(name);
  return {
    name: 'agridx-literature-assets',
    configureServer(server) {
      server.middlewares.use('/assets/literature/', (req,res,next) => {
        const name=(req.url ?? '').split('?')[0].replace(/^\//, '');
        if (!allowed(name) || !existsSync(path.join(directory,name))) return next();
        res.setHeader('Content-Type',name.endsWith('.gz')?'application/gzip':'application/json');
        res.end(readFileSync(path.join(directory,name)));
      });
    },
    generateBundle() {
      if (!existsSync(path.join(directory,'manifest.json'))) return;
      for (const file of readdirSync(directory).filter(allowed)) this.emitFile({type:'asset',fileName:`assets/literature/${file}`,source:readFileSync(path.join(directory,file))});
    },
  };
}

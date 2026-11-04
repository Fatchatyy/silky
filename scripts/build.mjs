// Production build of the storefront (npm run build).
//
// Vite takes NODE_ENV from .env when the environment does not set it, and the project's .env says
// NODE_ENV=development (for the API server). A plain `vite build` then ships React's development build: about
// four times more JavaScript, slower pages, and local file paths inside the public bundle. Setting NODE_ENV here,
// before Vite starts, makes the build the same on every machine (Windows included, no extra package needed).
//
// Optional: --outDir <folder> builds into another folder (emptied first), used by the SEO tests.
process.env.NODE_ENV = 'production';

const { build } = await import('vite');

const outDirFlag = process.argv.indexOf('--outDir');
const outDir = outDirFlag === -1 ? undefined : process.argv[outDirFlag + 1];

await build(outDir ? { build: { outDir, emptyOutDir: true } } : {});

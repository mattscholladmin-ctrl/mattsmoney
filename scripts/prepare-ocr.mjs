// Serve the pinned OCR worker, core and language data from this app. Receipt
// images stay in the browser; no runtime CDN or third-party OCR service is used.
import {mkdir,copyFile,readdir,readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
const target='public/ocr/7.0.0'
await mkdir(target,{recursive:true})
await copyFile('node_modules/tesseract.js/dist/worker.min.js',join(target,'worker.min.js'))
for(const name of await readdir('node_modules/tesseract.js-core')) {
 if(name.endsWith('.wasm.js'))await copyFile(join('node_modules/tesseract.js-core',name),join(target,name))
}
await copyFile('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',join(target,'eng.traineddata.gz'))
await writeFile(join(target,'LICENSE-core.txt'),await readFile('node_modules/tesseract.js-core/LICENSE'))
await writeFile(join(target,'NOTICE.txt'),'OCR: Tesseract.js 7.0.0 (Apache-2.0); tesseract.js-core (Apache-2.0); @tesseract.js-data/eng 1.0.0 (MIT). See installed package licenses.\n')
console.log('Prepared local receipt-reading assets.')

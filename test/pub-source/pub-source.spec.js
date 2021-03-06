const fs = require("fs");
const path = require("path");
const util = require("util");
const jetpack = require("fs-jetpack");
const shins = require("../../index");
const source = require('../helpers').source;
const compare = require('../helpers').compare;
const render = require('../helpers').render;

const output_dir = path.join(__dirname, "output");
const tmp_dir = path.join(__dirname, ".tmp");

describe('embedded custom pub directory tests', () => {
    const title = "<title>New Layout</title>";
    const custom_layout = path.join(tmp_dir, "/source/layouts/layout.ejs");

    beforeEach(() => {
        jetpack.remove(output_dir);
        jetpack.remove(tmp_dir);
        jetpack.dir(output_dir);
        jetpack.dir(tmp_dir);
        jetpack.copy(path.join(__dirname, '../../source'), path.join(tmp_dir, 'source'));
        const newLayout = fs.readFileSync(custom_layout, 'utf8').replace(/<title.*\/title>/, title);
        fs.writeFileSync(custom_layout, newLayout);
        jetpack.copy(path.join(__dirname, '../../pub'), path.join(tmp_dir, 'pub'));
        fs.writeFileSync(`${tmp_dir}/pub/css/print.css`, "UPDATED");
    });

    afterEach(() => {
        jetpack.remove(output_dir);
        jetpack.remove(tmp_dir);
    });

    it('creates inline output in "./output/index.html" directory', async () => {
        let options = shins.processOptions({
            inline: true,
            srcdir: path.join(path.join(tmp_dir, 'source')),
            pubdir: path.join(path.join(tmp_dir, 'pub')),
            output: path.join(output_dir, "index.html"),
        });
        const html = await render(source, options);
        expect(jetpack.exists(output_dir)).toEqual("dir");
        expect(jetpack.list(`${options.outdir}`).length).toEqual(1);
        expect(html.indexOf(title)).not.toBe(-1);
        expect(html.indexOf("UPDATED")).not.toBe(-1);
    });

    it('creates minified output in "./output/pub" and "./output/source" directories', async () => {
        let options = shins.processOptions({
            minify: true,
            srcdir: path.join(path.join(tmp_dir, 'source')),
            pubdir: path.join(path.join(tmp_dir, 'pub')),
            output: path.join(output_dir, "index.html")
        });
        const html = await render(source, options);
        expect(jetpack.exists(output_dir)).toEqual("dir");
        expect(jetpack.exists(`${output_dir}/index.html`)).toEqual("file");
        expect(jetpack.exists(`${output_dir}/pub`)).toEqual("dir");
        expect(jetpack.exists(`${output_dir}/source`)).toEqual("dir");
        expect(html.indexOf(title)).not.toBe(-1);
        compare(`${tmp_dir}/pub/css/print.css`, `${output_dir}/pub/css/print.css`);
    });

});

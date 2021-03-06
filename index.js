'use strict';

const fs = require('fs');
const path = require('path');
const util = require('util');
const jetpack = require('fs-jetpack');

const maybe = require('call-me-maybe');

var hljs = require('highlightjs/highlight.pack.js');
var hlpath = require.resolve('highlightjs/highlight.pack.js').replace('highlight.pack.js', '');

const emoji = require('markdown-it-emoji');
const attrs = require('markdown-it-attrs');
var md = require('markdown-it')({
    linkify: true, html: true,
    highlight: function (str, lang) {
        var slang = lang.split('--')[0]; // allows multiple language tabs for the same language
        if (slang && hljs.getLanguage(slang)) {
            try {
                return '<pre class="highlight tab tab-' + lang + '"><code>' +
                    hljs.highlight(slang, str, true).value +
                    '</code></pre>';
            } catch (__) { }
        }

        return '<pre class="highlight"><code>' + md.utils.escapeHtml(str) + '</code></pre>';
    }
}).use(require('markdown-it-lazy-headers'));
md.use(emoji);
const yaml = require('js-yaml');
const ejs = require('ejs');
const uglify = require('uglify-js');
const cheerio = require('cheerio');
const sanitizeHtml = require('sanitize-html');

let globalOptions = {};

function safeReadFileSync(filename,encoding) {
    try {
        return fs.readFileSync(filename,encoding);
    }
    catch (ex) {
        if (globalOptions.debug) console.error(`shins: included file ${filename} not found`);
        if (globalOptions.cli) process.exit(1);
    }
    return '';
}

function safeCopyFileSync(srcFileOrDir, outfile, encoding = 'utf8') {
    let outdir = path.dirname(outfile);
    if (!fs.existsSync(outdir)) {
        if (globalOptions.debug) console.log(`Creating ${outdir}`);
        jetpack.dir(outdir);
    }
    if (globalOptions.debug) console.log(`Copying ${srcFileOrDir} to ${outfile}`);
    jetpack.copy(srcFileOrDir, outfile, {
        overwrite: (src, dest) => {
            let overwrite = ((src.modifyTime > dest.modifyTime) || globalOptions.overwrite);
            if (globalOptions.debug) console.log(`${overwrite ? '...Overwriting' : '...NOT Overwriting'} ${dest.name}`);
            return overwrite;
        }
    });
}

function safeWriteFileSync(outfile, content, encoding = 'utf8') {
    let outdir = path.dirname(outfile);
    if (!fs.existsSync(outdir)) {
        if (globalOptions.debug) console.log(`Creating ${outdir}`);
        jetpack.dir(outdir);
    }
    fs.writeFileSync(outfile, content, encoding);
}

function javascript_include_tag(include) {
    var includeStr = safeReadFileSync(path.join(globalOptions.srcdir, '/javascripts/' + include + '.inc'), 'utf8');
    if (globalOptions.minify) {
        var scripts = [];
        var includes = includeStr.split('\r').join().split('\n');
        for (var i in includes) {
            var inc = includes[i];
            var elements = inc.split('"');
            if (elements[1]) {
                if (elements[1] == 'text/javascript') {
                    scripts.push(path.join(globalOptions.srcdir, '/javascripts/all_nosearch.js'));
                    break;
                }
                else {
                    scripts.push(path.join(globalOptions.topdir, elements[1]));
                }
            }
        }
        var bundle = uglify.minify(scripts);
        if (globalOptions.inline) {
            includeStr = '<script>'+bundle.code+'</script>';
        }
        else {
            safeWriteFileSync(path.join(globalOptions.outdir, 'pub/js/shins.js'), bundle.code, 'utf8');
            includeStr = safeReadFileSync(path.join(globalOptions.srcdir, '/javascripts/' + include + '.bundle.inc'), 'utf8');
        }
    } else {
        safeCopyFileSync(path.join(globalOptions.srcdir, 'javascripts/app/'), path.join(globalOptions.outdir, 'source/javascripts/app/'));
        safeCopyFileSync(path.join(globalOptions.srcdir, 'javascripts/lib/'), path.join(globalOptions.outdir, 'source/javascripts/lib/'));
    }
    return includeStr;
}

function partial(include) {
    var includePath = "";
    if (include.indexOf("/") === 0) {
        includePath = path.join(globalOptions.srcdir, include + '.md');
    }
    else {
        includePath = path.join(globalOptions.srcdir, '/includes/_' + include + '.md');
    }
    var includeStr = safeReadFileSync(includePath, 'utf8');
    return postProcess(md.render(clean(includeStr)));
}

function replaceAll(target, find, replace) {
    return target.replace(new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), replace);
}

function stylesheet_link_tag(stylesheet, media) {
    var override = stylesheet;
    if ((stylesheet !== 'print') && (stylesheet !== 'screen')) {
        override = 'theme';
    }
    if (globalOptions.inline) {
        var suffix = '';
        var stylePath = path.join(globalOptions.pubdir, '/css/' + stylesheet + '.css');
        if (!fs.existsSync(stylePath)) {
            stylePath = path.join(hlpath, '/styles/' + stylesheet + '.css');
        }
        var styleContent = safeReadFileSync(stylePath, "utf8");
        styleContent = replaceAll(styleContent, '../../source/fonts/', globalOptions.fonturl||'https://raw.githubusercontent.com/Mermade/shins/master/source/fonts/');
        styleContent = replaceAll(styleContent, '../../source/', 'source/');
        if (globalOptions.customCss) {
            let overrideFilename = path.join(globalOptions.pubdir, '/css/' + override + '_overrides.css');
            if (fs.existsSync(overrideFilename)) {
                styleContent += '\n' + safeReadFileSync(overrideFilename, 'utf8');
            }
        }
        if (globalOptions.css) {
            if (fs.existsSync(globalOptions.css)) {
                styleContent += '\n' + safeReadFileSync(globalOptions.css, 'utf8');
            } else if (globalOptions.css.startsWith('http')) {
                suffix = '\n    <link rel="stylesheet" media="' + media + '" href="' + globalOptions.css + '">';
            }
        }
        return '<style media="'+media+'">'+styleContent+'</style>' + suffix;
    }
    else {
        if (media == 'screen') {
            var target = path.join(globalOptions.pubdir, '/css/' + stylesheet + '.css');
            if (!fs.existsSync(target)) {
                var source = path.join(hlpath, '/styles/' + stylesheet + '.css');
                fs.writeFileSync(target, safeReadFileSync(source));
            }
        }
        safeCopyFileSync(path.join(globalOptions.srcdir, 'fonts/'), path.join(globalOptions.outdir, 'source/fonts/'));
        safeCopyFileSync(path.join(globalOptions.pubdir, 'css/' + stylesheet + '.css'), path.join(globalOptions.outdir, 'pub/css/' + stylesheet + '.css'));
        var include = '<link rel="stylesheet" media="' + media + '" href="pub/css/' + stylesheet + '.css">';
        if (globalOptions.customCss) {
            safeCopyFileSync(path.join(globalOptions.pubdir, 'css/' + override + '_overrides.css'), path.join(globalOptions.outdir, 'pub/css/' + override + '_overrides.css'));
            include += '\n    <link rel="stylesheet" media="' + media + '" href="pub/css/' + override + '_overrides.css">';
        }
        if (globalOptions.css) {
            include += '\n    <link rel="stylesheet" media="' + media + '" href="' + globalOptions.css + '">';
            if (fs.existsSync(path.join(globalOptions.topdir, globalOptions.css))) {
                safeCopyFileSync(path.join(globalOptions.topdir, globalOptions.css), path.join(globalOptions.outdir, globalOptions.css))
            }
        }
        return include;
    }
}

function language_array(language_tabs) {
    var result = [];
    for (var lang in language_tabs) {
        if (typeof language_tabs[lang] === 'object') {
            result.push(Object.keys(language_tabs[lang])[0]);
        }
        else {
            result.push(language_tabs[lang]);
        }
    }
    return JSON.stringify(result).split('"').join('&quot;');
}

function preProcess(content,options) {
    let lines = content.split('\r').join('').split('\n');
    for (let l=0;l<lines.length;l++) {
        let line = lines[l];
        let filename = '';
        if (line.startsWith('include::') && line.endsWith('[]')) { // asciidoc syntax
            filename = line.split(':')[2].replace('[]','');
        }
        else if (line.startsWith('!INCLUDE ')) { // markdown-pp syntax
            filename = line.replace('!INCLUDE ','');
        }
        if (filename) {
            if (options.source) filename = path.resolve(path.dirname(options.source),filename);
            let s = safeReadFileSync(filename,'utf8');
            let include = s.split('\r').join('').split('\n');
            lines.splice(l,1,...include);
        }
        else lines[l] = line;
    }
    return lines.join('\n');
}

function cleanId(id) {
    return id.toLowerCase().replace(/\W/g, '-');
}

function postProcess(content) {
    // adds id a la GitHub autolinks to automatically-generated headers
    content = content.replace(/\<(h[123456])\>(.*)\<\/h[123456]\>/g, function (match, header, title) {
        return '<' + header + ' id="' + cleanId(title) + '">' + title + '</' + header + '>';
    });

    // clean up the other ids as well
    content = content.replace(/\<(h[123456]) id="(.*)"\>(.*)\<\/h[123456]\>/g, function (match, header, id, title) {
        return '<' + header + ' id="' + cleanId(id) + '">' + title + '</' + header + '>';
    });
    return content;
}

function clean(s) {
    if (!s) return '';
    if (globalOptions.unsafe) return s;
    let sanitizeOptions = {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat([ 'h1', 'h2', 'img', 'aside', 'article', 'details',
            'summary', 'abbr', 'meta', 'link' ]),
        allowedAttributes: { a: [ 'href', 'id', 'name', 'target', 'class' ], img: [ 'src', 'alt', 'class' ] , aside: [ 'class' ],
            abbr: [ 'title', 'class' ], details: [ 'open', 'class' ], div: [ 'class' ], meta: [ 'name', 'content' ],
            link: [ 'rel', 'href', 'type', 'sizes' ],
            h1: [ 'id' ], h2: [ 'id' ], h3: [ 'id' ], h4: [ 'id' ], h5: [ 'id' ], h6: [ 'id' ]}
    };
    // replace things which look like tags which sanitizeHtml will eat
    s = s.split('\n>').join('\n$1$');
    s = s.split('>=').join('$2$');
    s = s.split('<=').join('$3$');
    let a = s.split('```');
    for (let i=0;i<a.length;i++) {
        if (!a[i].startsWith('xml')) {
            a[i] = sanitizeHtml(a[i],sanitizeOptions);
        }
    }
    s = a.join('```');
    // put back things which sanitizeHtml has mangled
    s = s.split('&quot;').join('"');
    s = s.split('&amp;').join('&');
    s = s.split('&gt;').join('>');
    s = s.split('&lt;').join('<');
    s = s.split('\n$1$').join('\n>');
    s = s.split('$2$').join('>=');
    s = s.split('$3$').join('<=');
    return s;
}

function render(inputStr, options, callback) {
    if (options.attr) md.use(attrs);
    if (options.hasOwnProperty('no-links')) md.disable('linkify')

    if (typeof callback === 'undefined') { // for pre-v1.4.0 compatibility
        callback = options;
        options = {};
    }
    if (options.inline == true) {
        options.minify = true;
    }
    return maybe(callback, new Promise(function (resolve, reject) {
        globalOptions = options;

        inputStr = inputStr.split('\r\n').join('\n');
        var inputArr = ('\n' + inputStr).split('\n---\n');
        if (inputArr.length === 1) {
            inputArr = ('\n' + inputStr).split('\n--- \n');
        }
        var headerStr = inputArr[1];
        var header = yaml.safeLoad(headerStr);

        /* non-matching languages between Ruby Rouge and highlight.js at 2016/07/10 are
        ['ceylon','common_lisp','conf','cowscript','erb','factor','io','json-doc','liquid','literate_coffeescript','literate_haskell','llvm','make',
        'objective_c','plaintext','praat','properties','racket','sass','sed','shell','slim','sml','toml','tulip','viml'];*/
        var sh = hljs.getLanguage('bash');
        hljs.registerLanguage('shell', function (hljs) { return sh; });
        hljs.registerLanguage('sh', function (hljs) { return sh; });

        while (inputArr.length<3) inputArr.push('');

        var content = preProcess(inputArr[2],options);
        content = md.render(clean(content));
        content = postProcess(content);

        var locals = {};
        locals.current_page = {};
        locals.current_page.data = header;
        locals.page_content = content;
        locals.toc_data = function(content) {
            var $ = cheerio.load(content);
            var result = [];
            var h1,h2,h3,h4,h5;
            var headingLevel = header.headingLevel || 2;
            $(':header').each(function(e){
                var tag = $(this).get(0).tagName.toLowerCase();
                var entry = {};
                if (tag === 'h1') {
                    entry.id = $(this).attr('id');
                    entry.content = $(this).text();
                    entry.children = [];
                    h1 = entry;
                    result.push(entry);
                }
                if (tag === 'h2') {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h2 = child;
                    if (h1) h1.children.push(child);
                }
                if ((headingLevel >= 3) && (tag === 'h3')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h3 = child;
                    if (h2) h2.children.push(child);
                }
                if ((headingLevel >= 4) && (tag === 'h4')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h4 = child;
                    if (h3) h3.children.push(child);
                }
                if ((headingLevel >= 5) && (tag === 'h5')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    child.children = [];
                    h5 = child;
                    if (h4) h4.children.push(child);
                }
                if ((headingLevel >= 6) && (tag === 'h6')) {
                    let child = {};
                    child.id = $(this).attr('id');
                    child.content = $(this).text();
                    if (h5) h5.children.push(child);
                }
            });
            return result; //[{id:'test',content:'hello',children:[]}];
        };
        locals.partial = partial;
        locals.image_tag = function (image, altText, className) {
            var imageSource = "source/images/" + image;
            if (globalOptions.inline) {
                var imgContent = safeReadFileSync(path.join(globalOptions.topdir, imageSource));
                imageSource = "data:image/png;base64," + Buffer.from(imgContent).toString('base64');
            } else {
                safeCopyFileSync(path.join(globalOptions.topdir, imageSource), path.join(globalOptions.outdir, imageSource));
            }
            return '<img src="'+imageSource+'" class="' + className + '" alt="' + altText + '">';
        };
        locals.logo_image_tag = function () {
            if (!globalOptions.logo) return locals.image_tag('logo.png', 'Logo', 'logo.png');
            var imageSource = path.resolve(process.cwd(), globalOptions.logo);
            var imageName = path.basename(globalOptions.logo);
            var imgContent = safeReadFileSync(imageSource);
            if (globalOptions.inline) {
                imageSource = "data:image/png;base64," + Buffer.from(imgContent).toString('base64');
            } else {
                var logoPath = "images/custom_logo" + path.extname(imageSource);
                safeWriteFileSync(path.join(globalOptions.outdir, logoPath), imgContent);
                imageSource = logoPath;
            }
            var html = '<img src="' + imageSource + '" class="logo" alt="' + imageName + '">';
            if (globalOptions['logo-url']) {
                html = '<a href="' + md.utils.escapeHtml(globalOptions['logo-url']) + '">' + html + '</a>';
            }
            return html;
        };
        locals.stylesheet_link_tag = stylesheet_link_tag;
        locals.javascript_include_tag = javascript_include_tag;
        locals.language_array = language_array;

        var ejsOptions = {};
        ejsOptions.debug = false;
        let layoutFile = options.layout;        // Support absolute path for layout.ejs
        if (!fs.existsSync(layoutFile)) {
            layoutFile = path.join(globalOptions.srcdir, options.layout || '/layouts/layout.ejs');
        }
        ejs.renderFile(layoutFile, locals, ejsOptions, function (err, str) {
            if (err) reject(err)
            else resolve(str);
        });
    }));
}

// Moved here to allow testing of options
function processOptions(options) {
    if (options.customcss) options.customCss = options.customcss; // backwards compatibility

    if (options.h) options.help   = options.h;
    if (options.a) options.attr   = options.a;
    if (options.l) options.layout = options.l;
    if (options.o) options.output = options.o;

    const dirname = path.dirname(__filename);
    options.outdir = path.dirname(options.output || dirname);

    options.srcdir = options.srcdir || path.join(dirname, 'source');
    options.pubdir = options.pubdir || path.join(dirname, 'pub');
    options.overwrite = !!options.overwrite;
    options.debug = !!options.debug;

    options.topdir = path.dirname(options.srcdir);
    if (globalOptions.debug) console.debug(options);
    return options;
}

module.exports = {
    render: render,
    processOptions: processOptions,
    srcDir: function () { return globalOptions.srcdir; }
};


const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const axios = require('axios')
const $ = require('cheerio')
const hljs = require('highlight.js')
const typeParser = require('./type-parser.js')
var md = require('markdown-it')({
  html: true,
  highlight: function (str, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(lang, str).value
      } catch (__) {}
    }
    return ''
  }
})

const baseUri = 'http://nodejs.cn/api/'

let indexes = []
const menu = []

const outputPath = 'docs/'

// clone 中文文档
const docsPath = path.resolve(__dirname, 'docs', 'cn')
if (!fs.existsSync(docsPath)) {
  console.log('cloning https://github.com/nodejscn/node-api-cn.git')
  execSync('git clone --depth=1 https://github.com/nodejscn/node-api-cn.git ' + docsPath)
}

// clone 英文文档
const docsEnPath = path.resolve(__dirname, 'docs', 'en')
if (!fs.existsSync(docsEnPath)) {
  console.log('cloning https://github.com/nodejs/node.git')
  execSync('git clone --depth=1 https://github.com/nodejs/node.git ' + docsEnPath)
}

axios.get(baseUri).then(async (res) => {
  // 获取主目录
  $(res.data).find('#apicontent li a').each((i, item) => {
    const title = item['children'][0]['data']
    const url = item['attribs']['href']
    menu.push({
      t: title === 'N-API' ? title : title.split('-')[0].trim(),
      d: '目录: ' + title,
      p: outputPath + url
    })
  })

  // 遍历主目录
  for (let i = 0; i < menu.length; i++) {
    const pathname = menu[i].p.replace(outputPath, '')
    console.log(pathname)
    const res = await axios.get(baseUri + pathname)

    // 获得待生成的所有子目录
    const list = catalog($(res.data).find('#toc > ul'))

    // 合并生成markdown内容
    let content = generate(list, pathname, 1)

    // 将英文版文档的链接描述部分合并进content
    const enDocPath = path.join('docs', 'en', 'doc', 'api', pathname.replace('.html', '.md'))
    if (fs.existsSync(enDocPath)) {
      const enDoc = fs.readFileSync(enDocPath, { encoding: 'utf-8' })
      const enDocArr = enDoc.split('\n\n')
      content += '\n\n' + enDocArr[enDocArr.length - 1]
    }

    // 处理自定义类型链接问题
    content = linkJsTypeDocs(content)

    // 加入css路径,生成html
    const html = `<!DOCTYPE html><html lang="zh_CN"><head><meta charset="UTF-8"><title></title><link rel="stylesheet" href="../css/doc.css" /></head>
    <body><div class="markdown-body">${(md.render(content))}</div></body></html>`

    // 写入html文件
    const mdPath = path.join('public', 'docs', pathname)
    if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath)
    fs.writeFileSync(mdPath, html)
  }
  // 生成索引
  indexes = menu.concat(indexes)

  // 写入合索引文件
  const indexesPath = path.join('public', 'indexes.json')
  if (fs.existsSync(indexesPath)) fs.unlinkSync(indexesPath)
  fs.writeFileSync(indexesPath, JSON.stringify(indexes))

  console.log('\n\n处理完毕 ☕️')
})

function linkJsTypeDocs (text) {
  const TYPE_SIGNATURE = /\{[^}]+\}/g
  const typeMatches = text.match(TYPE_SIGNATURE)
  if (typeMatches) {
    typeMatches.forEach((typeMatch) => {
      try {
        const replace = typeParser.toLink(typeMatch)
        text = text.replace(typeMatch, replace)
      } catch (_) { }
    })
  }
  return text
}
function catalog (obj) {
  const list = []
  obj.find('> li').each((i, item) => {
    list[i] = {}
    var a = $(item).find('a')[0]
    list[i]['url'] = $(a).attr('href')
    list[i]['title'] = $(a).text()
    if ($(item).find('> ul').length > 0) {
      list[i]['children'] = []
      list[i]['children'] = catalog($(item).find('> ul'))
    }
  })
  return list
}

function generate (list, pathname, loop) {
  let content = ''
  list.forEach((item) => {
    const mdPath = getMarkdownPath(item.url)
    const text = fs.readFileSync(mdPath, { encoding: 'utf-8' })
    if (loop !== 1) {
      // 加入到索引
      indexes.push({
        t: item.title,
        d: getDesc(text),
        p: outputPath + pathname + item.url
      })
    }
    // 添加锚点
    const header = '\n<h2 id="' + item.url.slice(1) + '">' + item.title + '</h2>\n'
    content += header + text + '\n'
    if (item.children && item.children.length > 0) {
      content += generate(item.children, pathname, loop + 1)
    }
  })
  return content
}
function getMarkdownPath (url) {
  let urlArr = url.slice(1).split('_')
  let fileName = urlArr.slice(1).join('_')
  let mdPath = path.join('docs', 'cn', urlArr[0], fileName + '.md')
  // N-API 为特例
  if (urlArr[0] === 'n' && urlArr[1] === 'api') {
    mdPath = path.join('docs', 'cn', 'n-api', urlArr.slice(2).join('_') + '.md')
  }
  if (!fs.existsSync(mdPath)) {
    // 如果文件不存在, 则为url中带有下划线, 如: child_process
    fileName = urlArr.slice(2).join('_')
    mdPath = path.join('docs', 'cn', urlArr[0] + '_' + urlArr[1], fileName + '.md')
    if (!fs.existsSync(mdPath)) {
      console.log(mdPath + ' 不存在!')
      process.exit()
    }
  }
  return mdPath
}
function getDesc (text) {
  if (!text) {
    return ''
  }
  // 过滤注释、参数、引用、空行, 返回前50个字符, 用于搜索
  text = text.replace(/<!--[\s\S]+?-->|^\s*?\*.+|^\s*?> .+|```[\s\S]+?```/gm, '')
  text = text.replace(/\s+/g, ' ')
  return text.substr(0, 50)
}

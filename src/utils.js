const fs = require('fs');
const path = require('path');

// 项目内文件绝对路径获取函数
function resolveApp(dir) {
  return path.join(path.dirname(require.main.filename), '..', dir);
}

// 输出文件绝对路径获取函数
function resolveModule(dir) {
  return path.join(__dirname, '..', dir);
}

// 文件监听函数
function watchFile(files, cb) {
  [].concat(files).forEach((file) => {
    let timer = null;
    fs.watch(file, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(cb, 50);
    });
  });
}

// 文件写入函数
function writeFile(file, data) {
  return new Promise((resolve, reject) => {
    fs.writeFile(file, data, (err) => {
      if (err) reject(err);
      resolve(true);
    });
  });
}

// 文件移除函数
function removeFile(files) {
  [].concat(files).forEach((file) => {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  });
}

// 重置配置文件
function resetApp(paths) {
  const appPath = path.join(paths.dist, 'app.json');

  const app = require(appPath);
  const pages = require(paths.pages);

  // 清除 require 缓存
  require.cache[appPath] = null;
  require.cache[paths.pages] = null;

  app.pages = pages.map(page => page.path.replace(/^\//, ''));

  writeFile(appPath, JSON.stringify(app, null, '  '));
}

// 配置对比函数
function isConfigChanged(page, oldPages) {
  // 获取备份的页面索引
  const oldPageIndex = oldPages.findIndex(oldPage => oldPage.path === page.path);

  // 不存在备份配置说明为新增页面
  if (oldPageIndex === -1) return true;

  // 获取并移除备份的页面配置
  const oldPage = oldPages.splice(oldPageIndex, 1)[0];

  // 对比新旧配置的键
  const keys = Object.keys(page.config || {});
  const oldKeys = Object.keys(oldPage.config || {});

  if (keys.length !== oldKeys.length) return true;

  // 对比新旧配置的值
  return keys.some(key => page.config[key] !== oldPage.config[key]);
}

function genEntry(paths, options) {
  // 获取所有新旧页面的配置
  const pages = require(paths.pages);
  const oldPages = fs.existsSync(paths.bakPages) ? require(paths.bakPages) : [];

  // 清除 require 缓存
  require.cache[paths.pages] = null;
  require.cache[paths.bakPages] = null;

  // 获取新旧入口文件模板
  let template = fs.readFileSync(paths.template).toString().replace(/\n*.*mpType.*\n*/, '\n\n');
  const bakTemplate = fs.existsSync(paths.bakTemplate) ? fs.readFileSync(paths.bakTemplate).toString() : '';

  // 去除 mixin 混入语句
  const mixinReg = /\n*Vue\.mixin(.*).*\n*/;
  while (mixinReg.test(template)) {
    template = template.replace(mixinReg, '\n\n')
      // 去除 mixin 文件导入语句
      .replace(new RegExp(`\n*import ${RegExp.$1 || null}.*\n*`), '\n\n');
  }

  const isTemplateChanged = template !== bakTemplate;

  // 创建入口配置对象
  const entry = { app: paths.template };

  // 生成入口文件的队列
  const queue = pages.map((page) => {
    // 页面路径
    const pagePath = page.path.replace(/^\//, '');

    // 页面配置
    const pageConfig = JSON.stringify({ config: page.config }, null, '  ');

    // 入口文件的文件名
    const fileName = page.name || pagePath.replace(/\/(\w)/g, (match, $1) => $1.toUpperCase());

    // 入口文件的完整路径
    const entryPath = path.join(paths.entry, `${fileName}.js`);

    entry[pagePath] = entryPath;

    if (isTemplateChanged || isConfigChanged(page, oldPages)) {
      // 生成入口文件
      return writeFile(entryPath, template
        .replace(/import App from .*/, `import App from '@/${pagePath}'`)
        .replace(/export default ?{[^]*}/, `export default ${pageConfig}`));
    }

    return Promise.resolve(false);
  });

  // 备份文件
  if (options.cache) {
    Promise.all(queue).then((results) => {
      if (results.every(result => !result)) {
        return resetApp(paths);
      }
      // 备份页面配置文件
      writeFile(paths.bakPages, JSON.stringify(pages, null, '  '));
      // 备份入口模板文件
      writeFile(paths.bakTemplate, template);
    });
  }

  return entry;
}

module.exports = {
  resolveApp,
  resolveModule,
  watchFile,
  writeFile,
  removeFile,
  genEntry,
  resetApp,
};

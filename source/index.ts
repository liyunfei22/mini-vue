const buket = new WeakMap();
// 全局变量存储被应用的副作用
let activeEffect: any;
const data: any = { ok: true, text: "hello world" };
const obj = new Proxy(data, {
  get(target, key) {
    console.log('get...', key)
    track(target, key)
    return target[key];
  },
  set(target, key, value) {
    console.log('set...', key)
    // 设置属性
    target[key] = value;
    trigger (target, key)
    return true
  }
});
function track (target, key) {
  if (!activeEffect) return;
    let depsMap = buket.get(target);
    if (!depsMap) {
      buket.set(target, (depsMap = new Map()));
    }
    let deps = depsMap.get(key);
    if (!deps) {
      depsMap.set(key, (deps = new Set()));
    }
    deps.add(activeEffect);
    activeEffect.deps.push(deps)
}
function trigger (target, key) {
  // 从桶中取出depsMap {'target' => map}
  const depsMap = buket.get(target);
  if (!depsMap) return true;
  // 根据key取出所有副作用函数
  const effects:Set<Function> = depsMap.get(key);
  const effectToRun = new Set(effects);
  effectToRun.forEach((effectFn) => effectFn());
}

function effect(fn) {
  const effectFn = () => {
    cleanup(effectFn)
    activeEffect = effectFn
    fn()
  }
  // 用来存储与该副作用函数相关的依赖集合
  effectFn.deps = []
  effectFn()
}
function cleanup(effectFn) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}

effect(() => {
  console.log(obj.ok ? obj.text: 'not');
});
setTimeout(() => {
  obj.ok = false;
}, 1000);
setTimeout(() => {
  obj.text = 'ol';
}, 2000);
// const set = new Set([1]);
// const newSet = new Set(set)
// newSet.forEach(item => {
//   set.delete(1)
//   set.add(1)
//   console.log('遍历中')
// })

const buket = new WeakMap();
// 全局变量存储被应用的副作用
let activeEffect: any;
const data: any = { ok: true, text: "hello world" };
const obj = new Proxy(data, {
  get(target, key) {
    track(target, key)
    return target[key];
  },
  set(target, key, value) {
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
}
function trigger (target, key) {
  // 从桶中取出depsMap {'target' => map}
  const depsMap = buket.get(target);
  if (!depsMap) return true;
  // 根据key取出所有副作用函数
  const effects = depsMap.get(key);
  effects && effects.forEach((fn) => fn());
}
function effect(fn) {
  activeEffect = fn;
  fn();
}
effect(() => {
  console.log('执行')
  console.log(obj.ok ? obj.text: 'not');
});
setTimeout(() => {
  obj.ok = false;
}, 1000);

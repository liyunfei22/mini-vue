const buket: Set<Function> = new Set();
// 全局变量存储被应用的副作用
let activeEffect;
const data:any = { text: 'hello world' };
const obj = new Proxy(data, {
  get (target, key) {
    if (activeEffect) {
      buket.add(activeEffect);
    }
    return target[key]
  },
  set (target, key, value) {
    target[key] = value;
    buket.forEach(fn => fn())
    return true;
  }
});
function effect (fn) {
  activeEffect = fn
  fn()
}
effect(() => {
  console.log(obj.text)
});
setTimeout(() => {
  obj.text1 = 'lla'
}, 1000)
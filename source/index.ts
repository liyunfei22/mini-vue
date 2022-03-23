const buket = new WeakMap();
// 全局变量存储被应用的副作用
let activeEffect: any;
const effectStack:Function[] = []
const data: any = { foo: 1 };
let temp1, temp2;
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
  const effectToRun:Set<Function> = new Set();
  effects && effects.forEach((effectFn: Function) => {
    if (effectFn !== activeEffect) {
      effectToRun.add(effectFn);
    }
  })
  effectToRun.forEach((effectFn) => effectFn());
}

function cleanup(effectFn) {
  for (let i = 0; i < effectFn.deps.length; i++) {
    const deps = effectFn.deps[i]
    deps.delete(effectFn)
  }
  effectFn.deps.length = 0
}
function effect(fn, options = {}) {
  const effectFn = () => {
    cleanup(effectFn)
    activeEffect = effectFn
    effectStack.push(activeEffect)
    fn()
    effectStack.pop()
    activeEffect = effectStack[effectStack.length - 1]
  }
  effectFn.options = options
  // 用来存储与该副作用函数相关的依赖集合
  effectFn.deps = []
  effectFn()
}

// ----------------------------------------------------------------
// function render() {
//   console.log(obj.ok ? obj.text: 'not');
// }
// effect(render);
// ----------------------------------------------------------------
// 状态改变
// setTimeout(() => {
//   obj.ok = false;
// }, 1000);
// setTimeout(() => {
//   obj.text = 'ol';
// }, 2000);
// -------------------------------
// 执行副作用函数
// effect(function effect1() {
//   console.log('effect1 执行')
//   effect(function effect2() {
//     console.log('effect2 执行')
//     temp2 = obj.bar
//   })
//   temp1 = obj.foo
// })
effect(() => {
  console.log(obj.foo)
})
setTimeout(() => {
  obj.foo ++;
}, 1000);
// const set = new Set([1]);
// const newSet = new Set(set)
// newSet.forEach(item => {
//   set.delete(1)
//   set.add(1)
//   console.log('遍历中')
// })

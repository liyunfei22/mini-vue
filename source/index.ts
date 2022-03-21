const buket: Set<Function> = new Set();
const data = { text: 'hello world' };
const obj = new Proxy(data, {
  get (target, key) {
    buket.add(effect);
    return target[key]
  },
  set (target, key, value) {
    target[key] = value;
    buket.forEach(fn => fn())
    return true;
  }
});
function effect () {
  console.log(obj.text)
}
effect();
setTimeout(() => {
  obj.text = 'lla'
}, 1000)
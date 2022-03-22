var buket = new WeakMap();
// 全局变量存储被应用的副作用
var activeEffect;
var data = { text: 'hello world' };
var obj = new Proxy(data, {
    get: function (target, key) {
        if (!activeEffect)
            return;
        var depsMap = buket.get(target);
        if (!depsMap) {
            buket.set(target, depsMap = new Map());
        }
        var deps = depsMap.get(key);
        if (!deps) {
            depsMap.set(key, deps = new Set());
        }
        deps.add(activeEffect);
        return target[key];
    },
    set: function (target, key, value) {
        // 设置属性
        target[key] = value;
        // 从桶中取出depsMap {'target' => map}
        var depsMap = buket.get(target);
        if (!depsMap)
            return;
        // 根据key取出所有副作用函数
        var effects = depsMap.get(key);
        effects && effects.forEach(function (fn) { return fn(); });
        return true;
    }
});
function effect(fn) {
    activeEffect = fn;
    fn();
}
effect(function () {
    console.log(obj.text);
});
setTimeout(function () {
    obj.text1 = 'lla';
}, 1000);

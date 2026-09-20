/**
 * parserOptions.ts —— compiler-dom 的解析选项
 * 对应真 Vue packages/compiler-dom/src/parserOptions.ts：
 *   isNativeTag / isPreTag / voidElements / getTextMode / decodeEntities
 */
import { makeMap } from '@mini-vue/shared'
import type { ParserOptions } from '@mini-vue/compiler-core'

const NATIVE_TAGS = `html,body,base,head,link,meta,style,title,address,article,aside,footer,header,h1,h2,h3,h4,h5,h6,nav,section,div,dd,dl,dt,figcaption,figure,picture,hr,img,li,main,ol,p,pre,ul,a,b,abbr,bdi,bdo,br,cite,code,data,dfn,em,i,kbd,mark,q,rp,rt,ruby,s,samp,small,span,strong,sub,sup,time,u,var,wbr,area,audio,map,track,video,embed,object,param,source,canvas,script,noscript,del,ins,caption,col,colgroup,table,thead,tbody,td,th,tr,button,datalist,fieldset,form,input,label,legend,meter,optgroup,option,output,progress,select,textarea,details,dialog,menu,summary,template,blockquote,iframe,tfoot`

const VOID_TAGS = `area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr`

const isNativeTag = makeMap(NATIVE_TAGS)
const isVoidTag = makeMap(VOID_TAGS)

export const parserOptions: ParserOptions = {
  isVoidTag,
  isNativeTag,
  isPreTag: (tag) => tag === 'pre',
  isCustomElement: () => false,
  // mini：不做 HTML 实体解码（decodeEntities 恒等）
  decodeEntities: (raw) => raw,
}
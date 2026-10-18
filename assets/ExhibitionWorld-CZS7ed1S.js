import{r as n,u as te,j as t,I as ie}from"./index-DIJpguYa.js";import{S as me,k as Z,N as de,U as y,v as fe,W as Q,H as le,L as K,l as pe,m as ve,n as xe,o as se,p as ge,q as Se,e as je,b as $,P as we,V as N,d as oe,r as ae,f as _e,D as Me,s as be,t as De,u as ue,_ as re,w as Te,x as ye,h as Be,i as Ue,y as Re,T as ze,O as Fe,R as Ee,j as Pe,z as Ce}from"./TractorModel-BlMK9fDq.js";import{i as J,p as ke,W as ee,s as Ie,a as Ae,n as We}from"./ExhibitionPage-DGLhHpOb.js";import{L as Le}from"./loader-circle-CCGTcJ3N.js";import{T as Ne}from"./tractor-gIxS5gbl.js";import{A as Oe}from"./arrow-up-right-BSaQHl60.js";import"./tractor-model-info-R1GeECX6.js";import"./DeferredScene-CyEjYRTw.js";import"./useKnowledgeCatalog-BbSw5oWu.js";import"./common-knowledge-CIqHOEcc.js";import"./api-client-BtBzYHj_.js";import"./search-El_vBIZo.js";import"./layers-NBk7i-cK.js";import"./cpu-JOWxodYb.js";import"./check-DVOggCmj.js";import"./rotate-ccw-A9CCavLs.js";import"./chevron-right-BLAURZ4k.js";class Ge extends me{constructor(e=new Z){super({uniforms:{inputBuffer:new y(null),depthBuffer:new y(null),resolution:new y(new Z),texelSize:new y(new Z),halfTexelSize:new y(new Z),kernel:new y(0),scale:new y(1),cameraNear:new y(0),cameraFar:new y(1),minDepthThreshold:new y(0),maxDepthThreshold:new y(1),depthScale:new y(0),depthToBlurRatioBias:new y(.25)},fragmentShader:`#include <common>
        #include <dithering_pars_fragment>      
        uniform sampler2D inputBuffer;
        uniform sampler2D depthBuffer;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float minDepthThreshold;
        uniform float maxDepthThreshold;
        uniform float depthScale;
        uniform float depthToBlurRatioBias;
        varying vec2 vUv;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying vec2 vUv2;
        varying vec2 vUv3;

        void main() {
          float depthFactor = 0.0;
          
          #ifdef USE_DEPTH
            vec4 depth = texture2D(depthBuffer, vUv);
            depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));
            depthFactor *= depthScale;
            depthFactor = max(0.0, min(1.0, depthFactor + 0.25));
          #endif
          
          vec4 sum = texture2D(inputBuffer, mix(vUv0, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv1, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv2, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv3, vUv, depthFactor));
          gl_FragColor = sum * 0.25 ;

          #include <dithering_fragment>
          #include <tonemapping_fragment>
          #include <${fe>=154?"colorspace_fragment":"encodings_fragment"}>
        }`,vertexShader:`uniform vec2 texelSize;
        uniform vec2 halfTexelSize;
        uniform float kernel;
        uniform float scale;
        varying vec2 vUv;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying vec2 vUv2;
        varying vec2 vUv3;

        void main() {
          vec2 uv = position.xy * 0.5 + 0.5;
          vUv = uv;

          vec2 dUv = (texelSize * vec2(kernel) + halfTexelSize) * scale;
          vUv0 = vec2(uv.x - dUv.x, uv.y + dUv.y);
          vUv1 = vec2(uv.x + dUv.x, uv.y + dUv.y);
          vUv2 = vec2(uv.x + dUv.x, uv.y - dUv.y);
          vUv3 = vec2(uv.x - dUv.x, uv.y - dUv.y);

          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,blending:de,depthWrite:!1,depthTest:!1}),this.toneMapped=!1,this.setTexelSize(e.x,e.y),this.kernel=new Float32Array([0,1,2,2,3])}setTexelSize(e,o){this.uniforms.texelSize.value.set(e,o),this.uniforms.halfTexelSize.value.set(e,o).multiplyScalar(.5)}setResolution(e){this.uniforms.resolution.value.copy(e)}}class He{constructor({gl:e,resolution:o,width:r=500,height:a=500,minDepthThreshold:l=0,maxDepthThreshold:f=1,depthScale:j=0,depthToBlurRatioBias:g=.25}){this.renderToScreen=!1,this.renderTargetA=new Q(o,o,{minFilter:K,magFilter:K,stencilBuffer:!1,depthBuffer:!1,type:le}),this.renderTargetB=this.renderTargetA.clone(),this.convolutionMaterial=new Ge,this.convolutionMaterial.setTexelSize(1/r,1/a),this.convolutionMaterial.setResolution(new Z(r,a)),this.scene=new pe,this.camera=new ve,this.convolutionMaterial.uniforms.minDepthThreshold.value=l,this.convolutionMaterial.uniforms.maxDepthThreshold.value=f,this.convolutionMaterial.uniforms.depthScale.value=j,this.convolutionMaterial.uniforms.depthToBlurRatioBias.value=g,this.convolutionMaterial.defines.USE_DEPTH=j>0;const v=new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),_=new Float32Array([0,0,2,0,0,2]),h=new xe;h.setAttribute("position",new se(v,3)),h.setAttribute("uv",new se(_,2)),this.screen=new ge(h,this.convolutionMaterial),this.screen.frustumCulled=!1,this.scene.add(this.screen)}render(e,o,r){const a=this.scene,l=this.camera,f=this.renderTargetA,j=this.renderTargetB;let g=this.convolutionMaterial,v=g.uniforms;v.depthBuffer.value=o.depthTexture;const _=g.kernel;let h=o,M,c,T;for(c=0,T=_.length-1;c<T;++c)M=(c&1)===0?f:j,v.kernel.value=_[c],v.inputBuffer.value=h.texture,e.setRenderTarget(M),e.render(a,l),h=M;v.kernel.value=_[c],v.inputBuffer.value=h.texture,e.setRenderTarget(this.renderToScreen?null:r),e.render(a,l)}}let Ve=class extends Se{constructor(e={}){super(e),this._tDepth={value:null},this._distortionMap={value:null},this._tDiffuse={value:null},this._tDiffuseBlur={value:null},this._textureMatrix={value:null},this._hasBlur={value:!1},this._mirror={value:0},this._mixBlur={value:0},this._blurStrength={value:.5},this._minDepthThreshold={value:.9},this._maxDepthThreshold={value:1},this._depthScale={value:0},this._depthToBlurRatioBias={value:.25},this._distortion={value:1},this._mixContrast={value:1},this.setValues(e)}onBeforeCompile(e){var o;(o=e.defines)!=null&&o.USE_UV||(e.defines.USE_UV=""),e.uniforms.hasBlur=this._hasBlur,e.uniforms.tDiffuse=this._tDiffuse,e.uniforms.tDepth=this._tDepth,e.uniforms.distortionMap=this._distortionMap,e.uniforms.tDiffuseBlur=this._tDiffuseBlur,e.uniforms.textureMatrix=this._textureMatrix,e.uniforms.mirror=this._mirror,e.uniforms.mixBlur=this._mixBlur,e.uniforms.mixStrength=this._blurStrength,e.uniforms.minDepthThreshold=this._minDepthThreshold,e.uniforms.maxDepthThreshold=this._maxDepthThreshold,e.uniforms.depthScale=this._depthScale,e.uniforms.depthToBlurRatioBias=this._depthToBlurRatioBias,e.uniforms.distortion=this._distortion,e.uniforms.mixContrast=this._mixContrast,e.vertexShader=`
        uniform mat4 textureMatrix;
        varying vec4 my_vUv;
      ${e.vertexShader}`,e.vertexShader=e.vertexShader.replace("#include <project_vertex>",`#include <project_vertex>
        my_vUv = textureMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );`),e.fragmentShader=`
        uniform sampler2D tDiffuse;
        uniform sampler2D tDiffuseBlur;
        uniform sampler2D tDepth;
        uniform sampler2D distortionMap;
        uniform float distortion;
        uniform float cameraNear;
			  uniform float cameraFar;
        uniform bool hasBlur;
        uniform float mixBlur;
        uniform float mirror;
        uniform float mixStrength;
        uniform float minDepthThreshold;
        uniform float maxDepthThreshold;
        uniform float mixContrast;
        uniform float depthScale;
        uniform float depthToBlurRatioBias;
        varying vec4 my_vUv;
        ${e.fragmentShader}`,e.fragmentShader=e.fragmentShader.replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>

      float distortionFactor = 0.0;
      #ifdef USE_DISTORTION
        distortionFactor = texture2D(distortionMap, vUv).r * distortion;
      #endif

      vec4 new_vUv = my_vUv;
      new_vUv.x += distortionFactor;
      new_vUv.y += distortionFactor;

      vec4 base = texture2DProj(tDiffuse, new_vUv);
      vec4 blur = texture2DProj(tDiffuseBlur, new_vUv);

      vec4 merge = base;

      #ifdef USE_NORMALMAP
        vec2 normal_uv = vec2(0.0);
        vec4 normalColor = texture2D(normalMap, vUv * normalScale);
        vec3 my_normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );
        vec3 coord = new_vUv.xyz / new_vUv.w;
        normal_uv = coord.xy + coord.z * my_normal.xz * 0.05;
        vec4 base_normal = texture2D(tDiffuse, normal_uv);
        vec4 blur_normal = texture2D(tDiffuseBlur, normal_uv);
        merge = base_normal;
        blur = blur_normal;
      #endif

      float depthFactor = 0.0001;
      float blurFactor = 0.0;

      #ifdef USE_DEPTH
        vec4 depth = texture2DProj(tDepth, new_vUv);
        depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));
        depthFactor *= depthScale;
        depthFactor = max(0.0001, min(1.0, depthFactor));

        #ifdef USE_BLUR
          blur = blur * min(1.0, depthFactor + depthToBlurRatioBias);
          merge = merge * min(1.0, depthFactor + 0.5);
        #else
          merge = merge * depthFactor;
        #endif

      #endif

      float reflectorRoughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 reflectorTexelRoughness = texture2D( roughnessMap, vUv );
        reflectorRoughnessFactor *= reflectorTexelRoughness.g;
      #endif

      #ifdef USE_BLUR
        blurFactor = min(1.0, mixBlur * reflectorRoughnessFactor);
        merge = mix(merge, blur, blurFactor);
      #endif

      vec4 newMerge = vec4(0.0, 0.0, 0.0, 1.0);
      newMerge.r = (merge.r - 0.5) * mixContrast + 0.5;
      newMerge.g = (merge.g - 0.5) * mixContrast + 0.5;
      newMerge.b = (merge.b - 0.5) * mixContrast + 0.5;

      diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);
      `)}get tDiffuse(){return this._tDiffuse.value}set tDiffuse(e){this._tDiffuse.value=e}get tDepth(){return this._tDepth.value}set tDepth(e){this._tDepth.value=e}get distortionMap(){return this._distortionMap.value}set distortionMap(e){this._distortionMap.value=e}get tDiffuseBlur(){return this._tDiffuseBlur.value}set tDiffuseBlur(e){this._tDiffuseBlur.value=e}get textureMatrix(){return this._textureMatrix.value}set textureMatrix(e){this._textureMatrix.value=e}get hasBlur(){return this._hasBlur.value}set hasBlur(e){this._hasBlur.value=e}get mirror(){return this._mirror.value}set mirror(e){this._mirror.value=e}get mixBlur(){return this._mixBlur.value}set mixBlur(e){this._mixBlur.value=e}get mixStrength(){return this._blurStrength.value}set mixStrength(e){this._blurStrength.value=e}get minDepthThreshold(){return this._minDepthThreshold.value}set minDepthThreshold(e){this._minDepthThreshold.value=e}get maxDepthThreshold(){return this._maxDepthThreshold.value}set maxDepthThreshold(e){this._maxDepthThreshold.value=e}get depthScale(){return this._depthScale.value}set depthScale(e){this._depthScale.value=e}get depthToBlurRatioBias(){return this._depthToBlurRatioBias.value}set depthToBlurRatioBias(e){this._depthToBlurRatioBias.value=e}get distortion(){return this._distortion.value}set distortion(e){this._distortion.value=e}get mixContrast(){return this._mixContrast.value}set mixContrast(e){this._mixContrast.value=e}};const $e=n.forwardRef(({mixBlur:s=0,mixStrength:e=1,resolution:o=256,blur:r=[0,0],minDepthThreshold:a=.9,maxDepthThreshold:l=1,depthScale:f=0,depthToBlurRatioBias:j=.25,mirror:g=0,distortion:v=1,mixContrast:_=1,distortionMap:h,reflectorOffset:M=0,...c},T)=>{je({MeshReflectorMaterialImpl:Ve});const p=$(({gl:x})=>x),k=$(({camera:x})=>x),H=$(({scene:x})=>x);r=Array.isArray(r)?r:[r,r];const U=r[0]+r[1]>0,I=r[0],R=r[1],E=n.useRef(null);n.useImperativeHandle(T,()=>E.current,[]);const[b]=n.useState(()=>new we),[m]=n.useState(()=>new N),[B]=n.useState(()=>new N),[z]=n.useState(()=>new N),[A]=n.useState(()=>new oe),[W]=n.useState(()=>new N(0,0,-1)),[u]=n.useState(()=>new ae),[P]=n.useState(()=>new N),[L]=n.useState(()=>new N),[C]=n.useState(()=>new ae),[O]=n.useState(()=>new oe),[d]=n.useState(()=>new _e),V=n.useCallback(()=>{var x;const S=E.current.parent||((x=E.current)==null||(x=x.__r3f.parent)==null?void 0:x.object);if(!S||(B.setFromMatrixPosition(S.matrixWorld),z.setFromMatrixPosition(k.matrixWorld),A.extractRotation(S.matrixWorld),m.set(0,0,1),m.applyMatrix4(A),B.addScaledVector(m,M),P.subVectors(B,z),P.dot(m)>0))return;P.reflect(m).negate(),P.add(B),A.extractRotation(k.matrixWorld),W.set(0,0,-1),W.applyMatrix4(A),W.add(z),L.subVectors(B,W),L.reflect(m).negate(),L.add(B),d.position.copy(P),d.up.set(0,1,0),d.up.applyMatrix4(A),d.up.reflect(m),d.lookAt(L),d.far=k.far,d.updateMatrixWorld(),d.projectionMatrix.copy(k.projectionMatrix),O.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),O.multiply(d.projectionMatrix),O.multiply(d.matrixWorldInverse),O.multiply(S.matrixWorld),b.setFromNormalAndCoplanarPoint(m,B),b.applyMatrix4(d.matrixWorldInverse),u.set(b.normal.x,b.normal.y,b.normal.z,b.constant);const w=d.projectionMatrix;C.x=(Math.sign(u.x)+w.elements[8])/w.elements[0],C.y=(Math.sign(u.y)+w.elements[9])/w.elements[5],C.z=-1,C.w=(1+w.elements[10])/w.elements[14],u.multiplyScalar(2/u.dot(C)),w.elements[2]=u.x,w.elements[6]=u.y,w.elements[10]=u.z+1,w.elements[14]=u.w},[k,M]),[D,G,ce,X]=n.useMemo(()=>{const x={minFilter:K,magFilter:K,type:le},S=new Q(o,o,x);S.depthBuffer=!0,S.depthTexture=new Me(o,o),S.depthTexture.format=be,S.depthTexture.type=De;const w=new Q(o,o,x),Y=new He({gl:p,resolution:o,width:I,height:R,minDepthThreshold:a,maxDepthThreshold:l,depthScale:f,depthToBlurRatioBias:j}),he={mirror:g,textureMatrix:O,mixBlur:s,tDiffuse:S.texture,tDepth:S.depthTexture,tDiffuseBlur:w.texture,hasBlur:U,mixStrength:e,minDepthThreshold:a,maxDepthThreshold:l,depthScale:f,depthToBlurRatioBias:j,distortion:v,distortionMap:h,mixContrast:_,"defines-USE_BLUR":U?"":void 0,"defines-USE_DEPTH":f>0?"":void 0,"defines-USE_DISTORTION":h?"":void 0};return[S,w,Y,he]},[p,I,R,O,o,g,U,s,e,a,l,f,j,v,h,_]);return ue(()=>{var x;const S=E.current.parent||((x=E.current)==null||(x=x.__r3f.parent)==null?void 0:x.object);if(!S)return;S.visible=!1;const w=p.xr.enabled,Y=p.shadowMap.autoUpdate;V(),p.xr.enabled=!1,p.shadowMap.autoUpdate=!1,p.setRenderTarget(D),p.state.buffers.depth.setMask(!0),p.autoClear||p.clear(),p.render(H,d),U&&ce.render(p,D,G),p.xr.enabled=w,p.shadowMap.autoUpdate=Y,S.visible=!0,p.setRenderTarget(null)}),n.createElement("meshReflectorMaterialImpl",re({attach:"material",key:"key"+X["defines-USE_BLUR"]+X["defines-USE_DEPTH"]+X["defines-USE_DISTORTION"],ref:E},X,c))}),F=1e-5;function qe(s,e,o){const r=new ye,a=o-F;return r.absarc(F,F,F,-Math.PI/2,-Math.PI,!0),r.absarc(F,e-a*2,F,Math.PI,Math.PI/2,!0),r.absarc(s-a*2,e-a*2,F,Math.PI/2,0,!0),r.absarc(s-a*2,F,F,0,-Math.PI/2,!0),r}const Ze=n.forwardRef(function({args:[e=1,o=1,r=1]=[],radius:a=.05,steps:l=1,smoothness:f=4,bevelSegments:j=4,creaseAngle:g=.4,children:v,..._},h){return n.createElement("mesh",re({ref:h},_),n.createElement(Xe,{args:[e,o,r],radius:a,steps:l,smoothness:f,bevelSegments:j,creaseAngle:g}),v)}),Xe=n.forwardRef(function({args:[e=1,o=1,r=1]=[],radius:a=.05,steps:l=1,smoothness:f=4,bevelSegments:j=4,creaseAngle:g=.4,...v},_){const h=n.useMemo(()=>qe(e,o,a),[e,o,a]),M=n.useMemo(()=>({depth:r-a*2,bevelEnabled:!0,bevelSegments:j*2,steps:l,bevelSize:a-F,bevelThickness:a,curveSegments:f}),[r,a,f,j,l]),c=n.useRef(null);return n.useLayoutEffect(()=>{c.current&&(c.current.center(),Te(c.current,g))},[h,M,g]),n.useImperativeHandle(_,()=>c.current),n.createElement("extrudeGeometry",re({ref:c,args:[h,M]},v))}),Ke={alpha:!0,antialias:!0},Ye={type:Re},Je={position:[23,25,29],fov:35,near:.1,far:150};function Qe(){const{gl:s,scene:e}=$();return n.useEffect(()=>{const o=new Pe(s),r=new Ee,a=o.fromScene(r,.025);return e.environment=a.texture,e.environmentIntensity=.55,()=>{e.environment=null,a.dispose(),r.dispose(),o.dispose()}},[s,e]),null}function i({position:s,size:e,color:o="#182a3e",glow:r,rotation:a}){return Math.min(...e)<.2?t.jsxs("mesh",{position:s,rotation:a,castShadow:!0,receiveShadow:!0,children:[t.jsx("boxGeometry",{args:e}),t.jsx("meshStandardMaterial",{color:o,roughness:.33,metalness:.55,emissive:r??"#000000",emissiveIntensity:r?.65:0})]}):t.jsx(Ze,{args:e,position:s,rotation:a,radius:.055,smoothness:2,castShadow:!0,receiveShadow:!0,children:t.jsx("meshStandardMaterial",{color:o,roughness:.33,metalness:.55,emissive:r??"#000000",emissiveIntensity:r?.65:0})})}function q({position:s,radius:e,color:o,rotation:r=[-Math.PI/2,0,0],thickness:a=.025}){return t.jsxs("mesh",{position:s,rotation:r,children:[t.jsx("torusGeometry",{args:[e,a,8,80]}),t.jsx("meshStandardMaterial",{color:o,emissive:o,emissiveIntensity:1.1,roughness:.2,metalness:.65})]})}function et({color:s}){return t.jsxs("group",{children:[[-1.1,0,1.1].map((e,o)=>t.jsxs("group",{position:[e,.4,0],rotation:[0,-.22+o*.22,-.08+o*.08],children:[t.jsx(i,{size:[.85,1.65+o*.35,.55],position:[0,1+o*.16,0],color:"#b8c9d6"}),t.jsx(i,{size:[.08,1.69+o*.35,.61],position:[-.43,1+o*.16,0],color:"#22658b",glow:s}),[.4,.75,1.1].map(r=>t.jsx(i,{size:[.48,.025,.02],position:[.03,r+o*.35,.289],color:"#3b5a6c"},r))]},e)),t.jsx(i,{size:[4.2,.09,.12],position:[0,3.35,-.9],color:s,glow:s}),[-2,2].map(e=>t.jsx(i,{size:[.1,3.1,.12],position:[e,1.8,-.9],color:"#517888"},e))]})}function tt({color:s}){return t.jsxs("group",{children:[t.jsx(i,{size:[2.8,.3,2.2],position:[0,.45,0],color:"#273b4c"}),[-1.25,1.25].map(e=>t.jsxs("group",{children:[t.jsx(i,{size:[.16,2.7,.18],position:[e,1.95,-.7],color:"#b6c0bd"}),t.jsx(i,{size:[.035,2.3,.2],position:[e,1.95,-.6],color:s,glow:s})]},e)),t.jsx(i,{size:[2.8,.15,.5],position:[0,3.32,-.7],color:"#d1c7b7"}),t.jsxs("mesh",{position:[0,1.85,0],rotation:[.3,.6,.25],castShadow:!0,children:[t.jsx("icosahedronGeometry",{args:[.82,0]}),t.jsx("meshStandardMaterial",{color:"#a47f47",metalness:.8,roughness:.22})]}),t.jsx(q,{position:[0,1.85,0],radius:1.15,color:s,rotation:[Math.PI/2.8,.1,.2]}),[-.6,-.3,0,.3,.6].map((e,o)=>t.jsx(i,{position:[e,.73+Math.sin(o)*.08,1],size:[.11,.3+o%3*.17,.1],color:s,glow:s},e))]})}function rt({color:s}){return t.jsxs("group",{children:[t.jsx(i,{size:[3.4,.25,2.2],position:[0,.48,0],color:"#3e585c"}),t.jsxs("mesh",{position:[0,1.75,0],rotation:[0,.35,.45],castShadow:!0,children:[t.jsx("torusGeometry",{args:[.85,.23,12,36]}),t.jsx("meshStandardMaterial",{color:"#aab9b8",metalness:.86,roughness:.27})]}),t.jsx(q,{position:[0,1.75,0],radius:1.35,color:s,rotation:[0,.35,.45],thickness:.018}),[-1,1].map(e=>t.jsx(i,{size:[.45,.5,.5],position:[e*1.15,1.75,0],color:"#527b76"},e)),t.jsx(i,{size:[.12,1.1,.14],position:[0,1.05,0],color:"#3b565b"}),t.jsx(i,{size:[2.7,.07,.08],position:[0,.66,1.11],color:s,glow:s})]})}function st({color:s}){return t.jsxs("group",{children:[t.jsx(i,{size:[2.7,.3,2],position:[0,.48,0],color:"#354354"}),t.jsx("group",{position:[0,1.25,.1],rotation:[-.5,0,0],children:[-1,1].map(e=>t.jsxs("group",{rotation:[0,0,e*-.3],children:[t.jsx(i,{size:[1.05,.16,1.5],position:[e*.5,.2,0],color:"#c3d0d9"}),[-.45,-.15,.15,.45].map(o=>t.jsx(i,{size:[.65,.018,.02],position:[e*.52,.29,o],color:"#5a7484"},o))]},e))}),t.jsx(q,{position:[0,2.7,-.6],radius:.85,color:s,rotation:[.2,.25,0],thickness:.022}),[0,1,2].map(e=>t.jsxs("mesh",{position:[Math.cos(e*Math.PI*2/3)*.85,2.7+Math.sin(e*Math.PI*2/3)*.85,-.6],castShadow:!0,children:[t.jsx("sphereGeometry",{args:[.13,16,12]}),t.jsx("meshStandardMaterial",{color:"#dae7ec",metalness:.7,roughness:.2})]},e))]})}function ot({zone:s,selected:e,onSelect:o}){const r=te(),a=s.color;return t.jsxs("group",{position:[s.x,0,s.z],children:[t.jsxs("group",{onClick:l=>{l.stopPropagation(),o(s.id)},children:[t.jsxs("mesh",{position:[0,.13,0],receiveShadow:!0,castShadow:!0,children:[t.jsx("cylinderGeometry",{args:[2.7,2.8,.25,64]}),t.jsx("meshStandardMaterial",{color:e?"#294b60":"#1a3042",metalness:.72,roughness:.35})]}),t.jsx(q,{position:[0,.27,0],radius:2.65,color:a,thickness:e?.045:.018}),s.id==="knowledge"&&t.jsx(et,{color:a}),s.id==="diagnosis"&&t.jsx(tt,{color:a}),s.id==="models"&&t.jsx(rt,{color:a}),s.id==="research"&&t.jsx(st,{color:a})]}),t.jsx(Ce,{position:[0,4,0],center:!0,zIndexRange:[8,4],className:"world-label-wrap",children:t.jsxs("button",{type:"button",className:`world-zone-label${e?" is-selected":""}`,style:{"--zone-color":a},onClick:()=>o(s.id),children:[t.jsxs("span",{children:[s.number," / ",r==="zh"?"展区":"ZONE"]}),t.jsxs("strong",{children:[r==="zh"?s.zh:s.en,t.jsx(Oe,{size:13})]})]})})]})}function at(){const s=ie()==="dark",e=$(r=>r.size.width<700),o=n.useMemo(()=>Array.from({length:12},(r,a)=>-11+a*2),[]);return t.jsxs("group",{children:[t.jsx(i,{position:[0,-.5,0],size:[29,.9,24],color:s?"#202e3a":"#c4d3df"}),t.jsxs("mesh",{rotation:[-Math.PI/2,0,0],position:[0,-.035,0],receiveShadow:!0,children:[t.jsx("planeGeometry",{args:[28.7,23.7]}),t.jsx($e,{resolution:e?128:256,blur:e?[0,0]:[40,20],mixBlur:e?0:.75,mixStrength:1.3,mirror:.3,color:s?"#293c4b":"#b5c9d7",roughness:.65,metalness:.7,depthScale:.4,minDepthThreshold:.4,maxDepthThreshold:1.4})]}),[-1,1].map(r=>t.jsxs("group",{children:[t.jsx(i,{position:[0,-.02,r*11.9],size:[28.5,.025,.035],color:"#6fa8b9",glow:"#63c4d4"}),t.jsx(i,{position:[r*14.35,-.02,0],size:[.035,.025,23.6],color:"#6fa8b9",glow:"#63c4d4"}),t.jsx(i,{position:[r*2,.01,0],size:[.025,.018,22.8],color:"#668696"}),t.jsx(i,{position:[0,.01,r*1.95],size:[27,.018,.025],color:"#668696"}),o.map(a=>t.jsxs("group",{position:[a,0,r*11.35],children:[t.jsx(i,{size:[.1,.35,.1],position:[0,.18,0],color:"#283d4b"}),t.jsx(i,{size:[.14,.04,.14],position:[0,.37,0],color:"#a7d4dd",glow:"#b3e9f4"})]},a))]},r)),[-10,-7,-4,4,7,10].map(r=>t.jsxs("group",{children:[t.jsx(i,{position:[r,.012,0],size:[.6,.018,.025],color:"#94aab4"}),t.jsx(i,{position:[0,.012,r],size:[.025,.018,.6],color:"#94aab4"})]},r)),t.jsx(q,{position:[0,.025,0],radius:3.2,color:s?"#cfb785":"#a17c38",thickness:.013}),t.jsx(q,{position:[0,.025,0],radius:2.9,color:"#254353",thickness:.014}),[-1,1].map(r=>t.jsxs("group",{position:[r*13.15,0,0],children:[t.jsx(i,{size:[.5,3.4,.6],position:[0,1.7,-1.1],color:"#283e4c"}),t.jsx(i,{size:[.5,3.4,.6],position:[0,1.7,1.1],color:"#283e4c"}),t.jsx(i,{size:[.5,.25,3],position:[0,3.5,0],color:"#617f8a"}),t.jsx(i,{size:[.03,2.7,.06],position:[-r*.26,1.8,-1.1],color:"#93ddde",glow:"#a4efed"})]},r)),ee.map(r=>t.jsxs("group",{position:[r.x*1.4,0,r.z*1.75],children:[t.jsx(i,{size:[1.7,.3,.75],position:[0,.14,0],color:"#293e48"}),[-.5,0,.5].map(a=>t.jsxs("mesh",{position:[a,.48,0],castShadow:!0,children:[t.jsx("icosahedronGeometry",{args:[.37,0]}),t.jsx("meshStandardMaterial",{color:"#3f796e",roughness:.9})]},a))]},r.id))]})}function nt({mode:s,selected:e,focus:o,destination:r,reset:a,input:l,reducedMotion:f,onSelect:j,onPosition:g,onNearby:v,onLoaded:_}){const h=n.useRef(null),M=n.useRef(null),c=n.useRef(J()),T=n.useRef([]),p=n.useRef(null),k=n.useRef(0),H=n.useRef(J()),U=n.useRef(!0),I=n.useMemo(()=>new N,[]),R=n.useMemo(()=>new N,[]),{camera:E,size:b,invalidate:m}=$(),B=ie();return n.useEffect(()=>{m()},[B,m]),n.useEffect(()=>(l.wake=m,()=>{l.wake=void 0}),[l,m]),n.useEffect(()=>{c.current=J(),H.current={...c.current},T.current=[],p.current=null,l.actions.clear(),U.current=!0,v(null),g({...c.current}),m()},[a,l,m,v,g]),n.useEffect(()=>{T.current=r?ke(c.current,r.id):[],m()},[r,m]),n.useEffect(()=>{U.current=!0,s==="overview"&&(T.current=[],l.actions.clear()),m()},[s,o,b.width,b.height,l,m]),ue((z,A)=>{const W=new Set(l.actions.values());if(W.size&&(T.current=[]),s==="drive"){let d=Math.min(A,.2);for(;d>0;){const V=Math.min(d,.05);if(T.current.length){const D=Ie(c.current,T.current[0],V);c.current=D.state,D.arrived&&T.current.shift()}else c.current=Ae(c.current,W,V);d-=V}}else c.current.speed=0;const u=c.current;h.current&&(h.current.position.set(u.x,.4,u.z),h.current.rotation.y=u.heading);const P=We(u.x,u.z);P!==p.current&&(p.current=P,v(P));const L=s==="drive"&&(W.size>0||T.current.length>0||Math.abs(u.speed)>.01),C=H.current;if((u.x!==C.x||u.z!==C.z||u.heading!==C.heading)&&(z.clock.elapsedTime-k.current>.18||!L)&&(H.current={...u},g(H.current),k.current=z.clock.elapsedTime),s==="drive"||U.current){if(s==="drive")I.set(u.x,.5,u.z),R.set(u.x+8,7,u.z+10),b.width<650&&R.set(u.x+8,11,u.z+14);else if(o){const D=ee.find(G=>G.id===o);I.set(D.x,.8,D.z),R.set(D.x+9,9,D.z+12),b.width<650&&R.set(D.x+10,13,D.z+18)}else{I.set(0,0,0);const D=b.width/b.height,G=Math.max(1,1.25/D);R.set(23*G,25*G,29*G)}const d=f?1:1-Math.exp(-5*Math.min(A,.2));E.position.lerp(R,d),M.current?.target.lerp(I,d),M.current?.update(),E.position.distanceToSquared(R)>8e-4||(M.current?.target.distanceToSquared(I)??0)>8e-4||L?m():U.current=!1}L&&m()}),t.jsxs(t.Fragment,{children:[t.jsx("fog",{attach:"fog",args:[B==="dark"?"#18232e":"#eaf0f5",42,100]}),t.jsx("ambientLight",{intensity:B==="dark"?.85:1.15,color:"#d6e2eb"}),t.jsx("directionalLight",{position:[-8,18,10],intensity:3.2,color:"#fff3db",castShadow:!0,"shadow-mapSize":b.width<700?[512,512]:[1024,1024],"shadow-camera-left":-18,"shadow-camera-right":18,"shadow-camera-top":18,"shadow-camera-bottom":-18,"shadow-camera-far":60,"shadow-bias":-15e-5,"shadow-normalBias":.025}),t.jsx("directionalLight",{position:[8,6,-12],intensity:1.8,color:"#80caff"}),t.jsx(Qe,{}),t.jsx(at,{}),ee.map(z=>t.jsx(ot,{zone:z,selected:e===z.id,onSelect:j},z.id)),t.jsx(n.Suspense,{fallback:null,children:t.jsx("group",{ref:h,children:t.jsx(ze,{onLoaded:_})})}),t.jsx(Fe,{ref:M,makeDefault:!0,enabled:s==="overview",enablePan:!1,enableDamping:!f,minDistance:9,maxDistance:100,minPolarAngle:.15,maxPolarAngle:Math.PI/2.4,onStart:()=>{U.current=!1}})]})}function ne(){const s=te();return t.jsxs("div",{className:"world-fallback",children:[t.jsx(Ne,{size:70,strokeWidth:1}),t.jsx("h2",{children:s==="zh"?"三维空间暂不可用":"3D space is unavailable"}),t.jsx("p",{children:s==="zh"?"通过展区导航，仍可进入知识库、诊断和模型工坊。":"Use the zone navigation to open knowledge, diagnosis and the model studio."})]})}function Dt(s){const e=te(),[o,r]=n.useState(!1),[a]=n.useState(()=>{try{const f=document.createElement("canvas").getContext("webgl2");return f?.getExtension("WEBGL_lose_context")?.loseContext(),!!f}catch{return!1}}),l=n.useCallback(()=>r(!0),[]);return a?t.jsxs(Be,{FallbackComponent:ne,children:[t.jsx(Ue,{shadows:Ye,camera:Je,gl:Ke,dpr:[1,1.25],frameloop:"demand",role:"group","aria-label":e==="zh"?"农机三维园区，四个展区围绕中央广场":"3D machinery campus with four pavilions around a central plaza",children:t.jsx(nt,{...s,onLoaded:l})}),!o&&t.jsxs("div",{className:"world-loading",role:"status",children:[t.jsx(Le,{size:20}),t.jsx("span",{children:e==="zh"?"正在打开三维园区…":"Opening the 3D campus…"})]})]}):t.jsx(ne,{})}export{Dt as default};

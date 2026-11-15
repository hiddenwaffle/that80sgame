import { defaultFilterVert, Filter, GlProgram, UniformGroup } from 'pixi.js';

/** Big square blocks, each the colour at its middle: the old games' flashback mosaic. `block` is in CSS pixels; 1 is the picture as it is. */
const fragment = /* glsl */ `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform highp vec4 uInputSize;
uniform float uBlock;

void main() {
  if (uBlock <= 1.0) {
    finalColor = texture(uTexture, vTextureCoord);
    return;
  }
  vec2 px = vTextureCoord * uInputSize.xy;
  vec2 c = (floor(px / uBlock) + 0.5) * uBlock;
  finalColor = texture(uTexture, c * uInputSize.zw);
}
`;

export class MosaicFilter extends Filter {
  constructor(resolution: number) {
    const glProgram = GlProgram.from({ vertex: defaultFilterVert, fragment, name: 'mosaic-filter' });
    super({ glProgram, resources: { mosaicUniforms: new UniformGroup({ uBlock: { value: 1, type: 'f32' } }) } });
    this.resolution = resolution;
  }

  set block(px: number) {
    (this.resources.mosaicUniforms.uniforms as { uBlock: number }).uBlock = px;
  }
}

/**
 * クロマキーフィルタ
 * グリーンバック（または指定色）を透過させるPixiJSカスタムフィルタ
 */
import { Filter, GlProgram } from 'pixi.js';

// 頂点シェーダー（標準的なもの）
const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;

    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

// フラグメントシェーダー（クロマキー処理）
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform vec3 uKeyColor;      // キーとなる色（RGB 0-1）
uniform float uThreshold;    // 色の許容範囲
uniform float uSmoothing;    // エッジのスムージング

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    
    // キー色との距離を計算
    float dist = distance(color.rgb, uKeyColor);
    
    // スムージングを適用したアルファ値を計算
    float alpha = smoothstep(uThreshold, uThreshold + uSmoothing, dist);
    
    // 元のアルファ値と掛け合わせる
    finalColor = vec4(color.rgb, color.a * alpha);
}
`;

export interface ChromaKeyFilterOptions {
  /** キーとなる色 (hex値、例: 0x00FF00) */
  keyColor?: number;
  /** 色の許容範囲 (0-1、デフォルト: 0.3) */
  threshold?: number;
  /** エッジのスムージング (0-1、デフォルト: 0.1) */
  smoothing?: number;
}

/**
 * クロマキーフィルタクラス
 * 指定した色を透過させる
 */
export class ChromaKeyFilter extends Filter {
  private _keyColor: number;
  private _threshold: number;
  private _smoothing: number;

  constructor(options: ChromaKeyFilterOptions = {}) {
    const {
      keyColor = 0x00FF00, // デフォルト: 緑
      threshold = 0.3,
      smoothing = 0.1,
    } = options;

    const glProgram = GlProgram.from({
      vertex,
      fragment,
      name: 'chroma-key-filter',
    });

    super({
      glProgram,
      resources: {
        chromaKeyUniforms: {
          uKeyColor: { value: [0, 1, 0], type: 'vec3<f32>' },
          uThreshold: { value: threshold, type: 'f32' },
          uSmoothing: { value: smoothing, type: 'f32' },
        },
      },
    });

    this._keyColor = keyColor;
    this._threshold = threshold;
    this._smoothing = smoothing;

    // 初期色を設定
    this.keyColor = keyColor;
  }

  /** キーとなる色（透過させる色） */
  get keyColor(): number {
    return this._keyColor;
  }

  set keyColor(value: number) {
    this._keyColor = value;
    // hex値をRGB（0-1）に変換
    const r = ((value >> 16) & 0xFF) / 255;
    const g = ((value >> 8) & 0xFF) / 255;
    const b = (value & 0xFF) / 255;
    this.resources.chromaKeyUniforms.uniforms.uKeyColor = [r, g, b];
  }

  /** 色の許容範囲 */
  get threshold(): number {
    return this._threshold;
  }

  set threshold(value: number) {
    this._threshold = value;
    this.resources.chromaKeyUniforms.uniforms.uThreshold = value;
  }

  /** エッジのスムージング */
  get smoothing(): number {
    return this._smoothing;
  }

  set smoothing(value: number) {
    this._smoothing = value;
    this.resources.chromaKeyUniforms.uniforms.uSmoothing = value;
  }
}

// デフォルトのグリーンバック用フィルタを作成するヘルパー
export function createGreenScreenFilter(threshold = 0.4, smoothing = 0.15): ChromaKeyFilter {
  return new ChromaKeyFilter({
    keyColor: 0x00FF00, // RGB(0, 255, 0)
    threshold,
    smoothing,
  });
}

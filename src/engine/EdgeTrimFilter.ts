/**
 * エッジトリムフィルタ
 * 画像の端に残る半透明のフチ（アンチエイリアス残り）を除去する
 * 軽量なGPUシェーダー処理
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

// フラグメントシェーダー（エッジトリム処理）
// 半透明ピクセル（アルファが閾値以下）を完全に透明にする
const fragment = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uAlphaThreshold;  // これ以下のアルファを透明にする（0-1）
uniform float uEdgeSoftness;    // エッジのソフトネス（0=ハード、1=ソフト）

void main(void)
{
    vec4 color = texture(uTexture, vTextureCoord);
    
    // アルファ値が閾値以下なら透明にする
    // スムージングで急激な変化を防ぐ
    float alpha = color.a;
    
    // ソフトエッジ：閾値付近を滑らかに遷移
    float trimmedAlpha = smoothstep(uAlphaThreshold, uAlphaThreshold + uEdgeSoftness, alpha);
    
    // プリマルチプライドアルファで出力
    finalColor = vec4(color.rgb * trimmedAlpha, trimmedAlpha * alpha);
}
`;

export interface EdgeTrimFilterOptions {
  /** アルファ閾値（これ以下を透明に、0-1、デフォルト: 0.3） */
  alphaThreshold?: number;
  /** エッジのソフトネス（0-1、デフォルト: 0.2） */
  edgeSoftness?: number;
}

/**
 * エッジトリムフィルタクラス
 * 画像端の半透明ピクセルを除去する
 */
export class EdgeTrimFilter extends Filter {
  private _alphaThreshold: number;
  private _edgeSoftness: number;

  constructor(options: EdgeTrimFilterOptions = {}) {
    const {
      alphaThreshold = 0.3,  // 30%以下のアルファを除去
      edgeSoftness = 0.2,    // 滑らかな遷移
    } = options;

    const glProgram = GlProgram.from({
      vertex,
      fragment,
      name: 'edge-trim-filter',
    });

    super({
      glProgram,
      resources: {
        edgeTrimUniforms: {
          uAlphaThreshold: { value: alphaThreshold, type: 'f32' },
          uEdgeSoftness: { value: edgeSoftness, type: 'f32' },
        },
      },
    });

    this._alphaThreshold = alphaThreshold;
    this._edgeSoftness = edgeSoftness;
  }

  /** アルファ閾値（これ以下を透明に） */
  get alphaThreshold(): number {
    return this._alphaThreshold;
  }

  set alphaThreshold(value: number) {
    this._alphaThreshold = value;
    this.resources.edgeTrimUniforms.uniforms.uAlphaThreshold = value;
  }

  /** エッジのソフトネス */
  get edgeSoftness(): number {
    return this._edgeSoftness;
  }

  set edgeSoftness(value: number) {
    this._edgeSoftness = value;
    this.resources.edgeTrimUniforms.uniforms.uEdgeSoftness = value;
  }
}

// デフォルト設定のエッジトリムフィルタを作成するヘルパー
export function createEdgeTrimFilter(alphaThreshold = 0.3, edgeSoftness = 0.2): EdgeTrimFilter {
  return new EdgeTrimFilter({
    alphaThreshold,
    edgeSoftness,
  });
}

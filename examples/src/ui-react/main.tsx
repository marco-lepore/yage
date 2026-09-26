import { useState } from "react";
import type { ReactNode } from "react";
import { Component, Engine, Scene, Vec2, Transform } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent, texture } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import {
  UIReactPlugin,
  UIRoot,
  Panel,
  ScrollView,
  Text,
  Button,
  Image,
  Tooltip,
  PixiProgressBar,
  Checkbox,
  Anchor,
  useSceneSelector,
} from "@yagejs/ui-react";
import type { Placement } from "@yagejs/ui-react";
import { installDebugFromUrl, setupGameContainer } from "../shared/bootstrap";
import {
  textStyle,
  allAssets,
  defaultTextStyle,
  nineSliceBtnReact,
  panelBg,
  sprites as S,
  nineSlice,
} from "../shared/ui-theme";

// ---------------------------------------------------------------------------
// Additional assets for this example
// ---------------------------------------------------------------------------
const Logo = texture("/assets/yage.png");

// The library `<Tooltip>` is headless (no default visuals). For the common
// "string label in a themed box" case, wrap once: pass the bubble look as
// styled `content` (a `<Panel>` + `<Text>`) instead of `bg`/`textStyle`.
const TOOLTIP_PAD = { left: 10, right: 10, top: 6, bottom: 6 };

function StyledTooltip({
  content,
  placement = "top",
  children,
}: {
  content: string;
  placement?: Placement;
  children: ReactNode;
}) {
  return (
    <Tooltip
      placement={placement}
      content={
        <Panel bg={panelBg} padding={TOOLTIP_PAD}>
          <Text style={textStyle("caption")}>{content}</Text>
        </Panel>
      }
    >
      {children}
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// XP fill: advances with game time, so it stops while the scene is paused
// ---------------------------------------------------------------------------
const XP_PER_SECOND = 0.1;

/** Fills XP from 0 to 1 over time, then starts again from empty. */
class XpFill extends Component {
  value = 0;

  update(dt: number): void {
    this.value += XP_PER_SECOND * dt;
    if (this.value >= 1) this.value = 0;
  }
}

// ---------------------------------------------------------------------------
// React UI components
// ---------------------------------------------------------------------------

function MainMenu({ xpFill }: { xpFill: XpFill }) {
  const [showSaves, setShowSaves] = useState(false);
  const [hp, setHp] = useState(0.8);
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Read every frame. The menu re-renders only when the rounded percentage
  // changes.
  const xpPercent = useSceneSelector(() => Math.round(xpFill.value * 100));

  return (
    <Panel
      direction="column"
      padding={24}
      alignItems="center"
      bg={panelBg}
      maxHeight="90vh"
    >
      {/* Absolute-positioned badge — pinned to the menu's top-right corner.
          Stays outside the scroll area so it tracks the panel, not content. */}
      <Panel
        position="absolute"
        top={8}
        right={8}
        padding={{ left: 6, right: 6, top: 2, bottom: 2 }}
        bg={{ color: 0x6366f1, alpha: 1, radius: 4 }}
      >
        <Text style={textStyle("caption", { fontSize: 10, fill: 0xffffff })}>
          v0.6
        </Text>
      </Panel>

      {/* The menu grows as Continue (saves) and Settings expand. Cap the
          panel at 90vh and let the content scroll so it never exceeds the
          viewport. The inner panel keeps everything centered (the
          ScrollView's content stack is start-aligned). */}
      <ScrollView flexGrow={1}>
        <Panel direction="column" gap={12} alignItems="center">
          {/* Themed string tooltip via the local StyledTooltip wrapper. */}
          <StyledTooltip
            content="YAGE — Yet Another Game Engine"
            placement="bottom"
          >
            <Image texture={Logo} width={180} height={58} />
          </StyledTooltip>

          <Text style={textStyle("title", { fontSize: 28 })}>UI Demo</Text>
          <Text style={textStyle("subtitle")}>React API</Text>

          {/* HP bar with controls — the buttons shrink-to-fit their labels */}
          <Panel direction="column" gap={4} alignItems="center">
            <Text style={textStyle("body", { fill: 0x22c55e })}>
              {`HP: ${Math.round(hp * 100)}%`}
            </Text>
            <PixiProgressBar
              bg={S.sliderTrack}
              fill={S.sliderFillGreen}
              nineSliceSprite={nineSlice.track}
              value={hp * 100}
              width={200}
              height={12}
            />
            <Panel direction="row" gap={6}>
              <StyledTooltip content="-15% HP" placement="top">
                <Button
                  bg={{ color: 0x661111, alpha: 1, radius: 4 }}
                  hoverBg={{ color: 0x882222, alpha: 1, radius: 4 }}
                  textStyle={textStyle("caption")}
                  onClick={() => setHp((v) => Math.max(0, v - 0.15))}
                >
                  Take Damage
                </Button>
              </StyledTooltip>
              <StyledTooltip content="+15% HP" placement="top">
                <Button
                  bg={{ color: 0x115511, alpha: 1, radius: 4 }}
                  hoverBg={{ color: 0x228822, alpha: 1, radius: 4 }}
                  textStyle={textStyle("caption")}
                  onClick={() => setHp((v) => Math.min(1, v + 0.15))}
                >
                  Heal
                </Button>
              </StyledTooltip>
            </Panel>
          </Panel>

          {/* XP bar (auto-fills) */}
          <Panel direction="column" gap={4} alignItems="center">
            <Text style={textStyle("body", { fill: 0x3b82f6 })}>
              {`XP: ${xpPercent}%`}
            </Text>
            <PixiProgressBar
              bg={S.sliderTrack}
              fill={S.sliderFillBlue}
              nineSliceSprite={nineSlice.track}
              value={xpPercent}
              width={200}
              height={12}
            />
          </Panel>

          <Button
            width={200}
            height={40}
            textStyle={textStyle("button")}
            onClick={() => console.log("Start!")}
            {...nineSliceBtnReact}
          >
            Start Game
          </Button>

          <Button
            width={200}
            height={40}
            textStyle={textStyle("button")}
            onClick={() => setShowSaves((s) => !s)}
            {...nineSliceBtnReact}
          >
            Continue
          </Button>

          {showSaves && (
            <Panel direction="column" gap={6}>
              {[1, 2, 3].map((i) => (
                <Button
                  key={i}
                  width={180}
                  height={32}
                  textStyle={textStyle("buttonSmall")}
                  onClick={() => console.log(`Load save ${i}`)}
                  {...nineSliceBtnReact}
                >
                  {`Save ${i}`}
                </Button>
              ))}
            </Panel>
          )}

          {/* Rich tooltip: the headless bubble is styled entirely by passing a
          themed <Panel> as `content` (no bg/padding props on Tooltip). */}
          <Tooltip
            placement="right"
            content={
              <Panel
                direction="column"
                gap={2}
                bg={panelBg}
                padding={{ left: 10, right: 10, top: 8, bottom: 8 }}
              >
                <Text style={textStyle("caption", { fill: 0xffffff })}>
                  Audio & display
                </Text>
                <Text
                  style={textStyle("caption", { fontSize: 10, fill: 0x9ca3af })}
                >
                  Toggle to expand
                </Text>
              </Panel>
            }
          >
            <Button
              width={200}
              height={40}
              textStyle={textStyle("button")}
              onClick={() => setShowSettings((s) => !s)}
              {...nineSliceBtnReact}
            >
              Settings
            </Button>
          </Tooltip>

          {showSettings && (
            <Panel direction="column" gap={8} padding={8}>
              <Checkbox
                label="Sound"
                labelStyle={textStyle("body")}
                checked={sound}
                onChange={(v) => {
                  setSound(v);
                  console.log("Sound:", v);
                }}
              />
              <Checkbox
                label="Fullscreen"
                labelStyle={textStyle("body")}
                checked={fullscreen}
                onChange={(v) => {
                  setFullscreen(v);
                  console.log("Fullscreen:", v);
                }}
              />
            </Panel>
          )}

          <Button
            width={200}
            height={40}
            textStyle={textStyle("button")}
            onClick={() => console.log("Exit!")}
            {...nineSliceBtnReact}
          >
            Exit
          </Button>
        </Panel>
      </ScrollView>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class UIReactScene extends Scene {
  readonly name = "ui-react-example";
  readonly preload = [...allAssets, Logo];

  onEnter(): void {
    // A background shape so we can see the UI is in screen-space
    const bg = this.spawn("bg-circle");
    bg.add(new Transform({ position: new Vec2(400, 300) }));
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 120).fill({ color: 0x3b1d5e, alpha: 0.4 });
        g.circle(0, 0, 120).stroke({ color: 0xa78bfa, width: 2, alpha: 0.3 });
      }),
    );

    // Mount React UI
    const menuEntity = this.spawn("menu");
    const xpFill = menuEntity.add(new XpFill());
    const root = menuEntity.add(new UIRoot({ anchor: Anchor.Center }));
    root.render(<MainMenu xpFill={xpFill} />);
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  const engine = new Engine({ debug: true });

  engine.use(
    new RendererPlugin({
      width: 800,
      height: 600,
      virtualWidth: 800,
      virtualHeight: 600,
      backgroundColor: 0x0a0a0a,
      container: setupGameContainer(800, 600),
    }),
  );

  // `defaultTextStyle` sets the theme font/fill as the base for all UI text;
  // fonts load declaratively via the `webFont` handles in `allAssets` (scene
  // preload), replacing the old manual `document.fonts.load` call.
  engine.use(new UIPlugin({ defaultTextStyle }));
  engine.use(new UIReactPlugin());
  await installDebugFromUrl(engine);

  await engine.start();
  await engine.scenes.push(new UIReactScene());
}

main().catch(console.error);

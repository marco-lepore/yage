import { useState, useEffect } from "react";
import { Engine, Scene, Vec2, Transform } from "@yagejs/core";
import { RendererPlugin, GraphicsComponent, texture } from "@yagejs/renderer";
import { UIPlugin } from "@yagejs/ui";
import {
  UIRoot,
  Panel,
  Text,
  Button,
  Image,
  PixiProgressBar,
  Checkbox,
  Anchor,
} from "@yagejs/ui-react";
import { injectStyles, getContainer } from "./shared";
import {
  textStyle, loadFonts, allAssets, nineSliceBtnReact, panelBg,
  sprites as S, nineSlice,
} from "./ui-theme";

injectStyles();

// ---------------------------------------------------------------------------
// Additional assets for this example
// ---------------------------------------------------------------------------
const Logo = texture("/assets/yage.png");

// ---------------------------------------------------------------------------
// React UI components
// ---------------------------------------------------------------------------

function MainMenu() {
  const [showSaves, setShowSaves] = useState(false);
  const [hp, setHp] = useState(0.8);
  const [xp, setXp] = useState(0);
  const [sound, setSound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // Auto-fill XP over time
  useEffect(() => {
    const id = setInterval(() => {
      setXp((prev) => {
        const next = prev + 0.02;
        return next >= 1 ? 0 : next;
      });
    }, 200);
    return () => clearInterval(id);
  }, []);

  return (
    <Panel
      anchor="center"
      direction="column"
      gap={12}
      padding={24}
      alignItems="center"
      bg={panelBg}
    >
      <Image texture={Logo} width={180} height={58} />

      <Text style={textStyle("title", { fontSize: 28 })}>UI Demo</Text>
      <Text style={textStyle("subtitle")}>React API</Text>

      {/* HP bar with controls */}
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
          <Button
            width={110}
            height={28}
            bg={{ color: 0x661111, alpha: 1, radius: 4 }}
            hoverBg={{ color: 0x882222, alpha: 1, radius: 4 }}
            textStyle={textStyle("caption")}
            onClick={() => setHp((v) => Math.max(0, v - 0.15))}
          >
            Take Damage
          </Button>
          <Button
            width={60}
            height={28}
            bg={{ color: 0x115511, alpha: 1, radius: 4 }}
            hoverBg={{ color: 0x228822, alpha: 1, radius: 4 }}
            textStyle={textStyle("caption")}
            onClick={() => setHp((v) => Math.min(1, v + 0.15))}
          >
            Heal
          </Button>
        </Panel>
      </Panel>

      {/* XP bar (auto-fills) */}
      <Panel direction="column" gap={4} alignItems="center">
        <Text style={textStyle("body", { fill: 0x3b82f6 })}>
          {`XP: ${Math.round(xp * 100)}%`}
        </Text>
        <PixiProgressBar
          bg={S.sliderTrack}
          fill={S.sliderFillBlue}
          nineSliceSprite={nineSlice.track}
          value={xp * 100}
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

      <Button
        width={200}
        height={40}
        textStyle={textStyle("button")}
        onClick={() => setShowSettings((s) => !s)}
        {...nineSliceBtnReact}
      >
        Settings
      </Button>

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
    const root = menuEntity.add(new UIRoot({ anchor: Anchor.Center }));
    root.render(<MainMenu />);
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
      container: getContainer(),
    }),
  );

  engine.use(new UIPlugin());

  await loadFonts();
  await engine.start();
  await engine.scenes.push(new UIReactScene());
}

main().catch(console.error);

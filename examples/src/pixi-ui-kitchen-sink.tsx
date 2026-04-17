import { useState, useCallback, useMemo } from "react";
import { Engine, Scene, Vec2, Transform } from "@yagejs/core";
import { RendererPlugin, CameraKey, GraphicsComponent } from "@yagejs/renderer";
import { UIPlugin, createNineSliceView } from "@yagejs/ui";
import {
  UIRoot,
  Panel,
  Text,
  Anchor,
  PixiFancyButton,
  PixiCheckbox,
  PixiProgressBar,
  PixiSlider,
  PixiInput,
  PixiSelect,
  PixiRadioGroup,
} from "@yagejs/ui-react";
import { injectStyles, getContainer } from "./shared";
import {
  textStyle, loadFonts, assets, allAssets,
  nineSlice, btnTextOffset, panelBg,
} from "./ui-theme";

injectStyles();

/** Create a NineSliceSprite at a specific size (for composite widgets like Select
 *  where we can't rely on applyLayout to resize). */
function makeNineSlice(
  texture: (typeof assets)[keyof typeof assets],
  w: number,
  h: number,
  inset = 10,
) {
  return createNineSliceView({
    texture,
    width: w,
    height: h,
    insets: inset,
  });
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({ title, children, width = 340 }: { title: string; children: React.ReactNode; width?: number }) {
  return (
    <Panel direction="column" gap={8} padding={12} bg={{ color: 0x111827, alpha: 0.9, radius: 6 }} width={width}>
      <Text style={textStyle("label")}>{title}</Text>
      {children}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Main kitchen sink component
// ---------------------------------------------------------------------------
function KitchenSink() {
  // FancyButton
  const [btnClicks, setBtnClicks] = useState(0);
  const onBtnClick = useCallback(() => setBtnClicks((c) => c + 1), []);

  // Checkbox
  const [checked, setChecked] = useState(false);
  const onCheck = useCallback((v: boolean) => setChecked(v), []);

  // ProgressBar
  const [progress, setProgress] = useState(65);
  const decProgress = useCallback(() => setProgress((v) => Math.max(0, v - 10)), []);
  const incProgress = useCallback(() => setProgress((v) => Math.min(100, v + 10)), []);

  // Slider
  const [sliderVal, setSliderVal] = useState(50);
  const onSliderChange = useCallback((v: number) => setSliderVal(Math.round(v)), []);

  // Input
  const [inputText, setInputText] = useState("");
  const onInputChange = useCallback((v: string) => setInputText(v), []);

  // Select
  const [selectedIdx, setSelectedIdx] = useState(0);
  const onSelect = useCallback((idx: number) => setSelectedIdx(idx), []);

  // RadioGroup
  const [radioIdx, setRadioIdx] = useState(0);
  const onRadioChange = useCallback((idx: number) => setRadioIdx(idx), []);

  // NineSliceSprite views for Select trigger (composite widget, can't resize via applyLayout)
  const selectViews = useMemo(() => ({
    closed: makeNineSlice(assets.selectClosed, 180, 36),
    open: makeNineSlice(assets.selectOpen, 180, 36),
  }), []);

  return (
    <Panel
      anchor="center"
      direction="column"
      gap={14}
      padding={20}
      alignItems="center"
      bg={panelBg}
    >
      <Text style={textStyle("title")}>@pixi-ui Kitchen Sink</Text>
      <Text style={textStyle("subtitle")}>All Pixi* wrappers - React API</Text>

      {/* Row 1: FancyButton + Checkbox */}
      <Panel direction="row" gap={12} alignItems="flex-start">
        <Section title="Pixi FancyButton">
          <PixiFancyButton
            defaultView={assets.btnDefault}
            hoverView={assets.btnHover}
            pressedView={assets.btnPressed}
            nineSliceSprite={nineSlice.button}
            text={`Clicked: ${btnClicks}`}
            textStyle={textStyle("button")}
            textOffset={btnTextOffset}
            onClick={onBtnClick}
            width={200}
            height={40}
          />
          <PixiFancyButton
            defaultView={assets.btnDisabled}
            nineSliceSprite={nineSlice.button}
            text="Disabled"
            textStyle={textStyle("button", { fill: 0x999999 })}
            textOffset={btnTextOffset}
            disabled
            width={200}
            height={40}
          />
        </Section>

        <Section title="Pixi Checkbox">
          <PixiCheckbox
            checkedView={assets.checkboxChecked}
            uncheckedView={assets.checkboxUnchecked}
            text="Enable sound"
            checked={checked}
            onChange={onCheck}
            textStyle={textStyle("body")}
          />
          <Text style={textStyle("caption")}>
            {checked ? "Sound ON" : "Sound OFF"}
          </Text>
        </Section>
      </Panel>

      {/* Row 2: ProgressBar + Slider */}
      <Panel direction="row" gap={12} alignItems="flex-start">
        <Section title="Pixi ProgressBar">
          <PixiProgressBar
            bg={assets.sliderTrack}
            fill={assets.sliderFillGreen}
            nineSliceSprite={nineSlice.track}
            value={progress}
            width={200}
            height={16}
          />
          <Panel direction="row" gap={6}>
            <PixiFancyButton
              defaultView={assets.btnDefault}
              hoverView={assets.btnHover}
              pressedView={assets.btnPressed}
              nineSliceSprite={nineSlice.button}
              text="- 10"
              textStyle={textStyle("buttonSmall")}
              textOffset={btnTextOffset}
              onClick={decProgress}
              width={90}
              height={28}
            />
            <PixiFancyButton
              defaultView={assets.btnDefault}
              hoverView={assets.btnHover}
              pressedView={assets.btnPressed}
              nineSliceSprite={nineSlice.button}
              text="+ 10"
              textStyle={textStyle("buttonSmall")}
              textOffset={btnTextOffset}
              onClick={incProgress}
              width={90}
              height={28}
            />
          </Panel>
          <Text style={textStyle("caption")}>{`Progress: ${progress}%`}</Text>
        </Section>

        <Section title="Pixi Slider">
          <PixiSlider
            bg={assets.sliderTrack}
            fill={assets.sliderFillBlue}
            slider={assets.sliderHandle}
            nineSliceSprite={nineSlice.track}
            min={0}
            max={100}
            value={sliderVal}
            onChange={onSliderChange}
            width={200}
            height={16}
          />
          <Text style={textStyle("caption")}>{`Value: ${sliderVal}`}</Text>
        </Section>
      </Panel>

      {/* Row 3: Input + Select */}
      <Panel direction="row" gap={12} alignItems="flex-start">
        <Section title="Pixi Input">
          <PixiInput
            bg={assets.inputBg}
            nineSliceSprite={nineSlice.input}
            placeholder="Type here..."
            value={inputText}
            onChange={onInputChange}
            width={200}
            height={36}
            padding={[8, 10]}
            textStyle={textStyle("dark")}
          />
          <Text style={textStyle("caption")}>
            {inputText ? `You typed: ${inputText}` : "Empty"}
          </Text>
        </Section>

        <Section title="Pixi Select">
          <PixiSelect
            closedBG={selectViews.closed}
            openBG={selectViews.open}
            items={["Easy", "Normal", "Hard", "Nightmare"]}
            selected={selectedIdx}
            onSelect={onSelect}
            textStyle={textStyle("dark")}
            itemTextStyle={textStyle("body", { fontSize: 13 })}
            itemWidth={180}
            itemHeight={32}
            itemBG={0x1e293b}
            itemHoverBG={0x334155}
            visibleItems={4}
          />
          <Text style={textStyle("caption")}>
            {`Selected: ${["Easy", "Normal", "Hard", "Nightmare"][selectedIdx]}`}
          </Text>
        </Section>
      </Panel>

      {/* Row 4: RadioGroup — aligned left so the Select dropdown above is visible */}
      <Panel direction="row" gap={12} alignItems="flex-start" alignSelf="flex-start">
      <Section title="Pixi RadioGroup" width={380}>
        <PixiRadioGroup
          items={[
            { checkedView: assets.radioChecked, uncheckedView: assets.radioUnchecked, text: "Warrior", textStyle: textStyle("body") },
            { checkedView: assets.radioChecked, uncheckedView: assets.radioUnchecked, text: "Mage", textStyle: textStyle("body") },
            { checkedView: assets.radioChecked, uncheckedView: assets.radioUnchecked, text: "Rogue", textStyle: textStyle("body") },
          ]}
          type="horizontal"
          elementsMargin={12}
          selected={radioIdx}
          onChange={onRadioChange}
        />
        <Text style={textStyle("caption")}>
          {`Class: ${["Warrior", "Mage", "Rogue"][radioIdx]}`}
        </Text>
      </Section>
      </Panel>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
class KitchenSinkScene extends Scene {
  readonly name = "pixi-ui-kitchen-sink";
  readonly preload = allAssets;

  onEnter(): void {
    const camera = this.context.resolve(CameraKey);
    camera.position = new Vec2(400, 350);

    // Subtle background
    const bg = this.spawn("bg");
    bg.add(new Transform({ position: new Vec2(400, 350) }));
    bg.add(
      new GraphicsComponent().draw((g) => {
        g.circle(0, 0, 140).fill({ color: 0x1a0a2e, alpha: 0.4 });
        g.circle(0, 0, 140).stroke({ color: 0x6d28d9, width: 2, alpha: 0.2 });
      }),
    );

    // Mount React UI
    const uiEntity = this.spawn("kitchen-sink-ui");
    const root = uiEntity.add(new UIRoot({ anchor: Anchor.Center }));
    root.render(<KitchenSink />);
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
      height: 700,
      virtualWidth: 800,
      virtualHeight: 700,
      backgroundColor: 0x0a0a0a,
      container: getContainer(),
    }),
  );

  engine.use(new UIPlugin());

  await loadFonts();
  await engine.start();
  await engine.scenes.push(new KitchenSinkScene());
}

main().catch(console.error);

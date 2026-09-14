import { useEffect, useRef, useState } from "react";
import type {
  OpenTiledOutcome,
  TiledAssetInfo,
} from "../../shared/protocol/index.js";
import { Button } from "./controls.js";

export interface TiledAssetActions {
  describe(path: string): Promise<TiledAssetInfo>;
  open(path: string): Promise<OpenTiledOutcome>;
}

export function TiledAssetButton(props: {
  readonly path: string;
  readonly revision: number;
  readonly actions: TiledAssetActions;
}): React.JSX.Element | null {
  const [source, setSource] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const generation = useRef(0);
  const { path, revision, actions } = props;

  useEffect(() => {
    const current = ++generation.current;
    setSource(null);
    setPending(false);
    setMessage(undefined);
    if (/\.json$/i.test(path)) {
      actions.describe(path).then(
        (info) => {
          if (generation.current === current) setSource(info.source);
        },
        (error: unknown) => {
          if (generation.current === current) setMessage(describe(error));
        },
      );
    }
    return () => {
      generation.current += 1;
    };
  }, [path, revision, actions]);

  if (source === null && message === undefined) return null;
  return (
    <div>
      {source === null ? null : (
        <Button
          title={`Open ${source} in Tiled`}
          disabled={pending}
          onClick={() => {
            const current = generation.current;
            setPending(true);
            setMessage(undefined);
            actions.open(path).then(
              (answer) => {
                if (generation.current !== current) return;
                setPending(false);
                if (!answer.ok) setMessage(answer.message);
              },
              (error: unknown) => {
                if (generation.current !== current) return;
                setPending(false);
                setMessage(describe(error));
              },
            );
          }}
        >
          {pending ? "Opening Tiled…" : "Open in Tiled"}
        </Button>
      )}
      {message === undefined ? null : <p role="alert">{message}</p>}
    </div>
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

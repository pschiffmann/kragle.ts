import { Definitions } from "@kragle/runtime";
import { Scene } from "./runtime/index.js";
import { useEditorConnection } from "./use-editor-connection.js";

export interface StageProps {
  definitions: Definitions;
}

export function Stage({ definitions }: StageProps) {
  const runtime = useEditorConnection(definitions);
  return runtime ? (
    <Scene runtime={runtime} />
  ) : (
    <div>Connecting to Kragle editor ...</div>
  );
}

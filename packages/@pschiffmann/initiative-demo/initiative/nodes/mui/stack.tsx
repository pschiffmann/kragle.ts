import { NodeComponentProps } from "@initiative.dev/schema";
import { Box, Stack as MuiStack } from "@mui/material";
import { StackSchema } from "./stack.schema.js";

export function Stack({
  flexDirection,
  gap,
  alignSelf,
  slots,
}: NodeComponentProps<StackSchema>) {
  return (
    <MuiStack flexDirection={flexDirection} gap={gap}>
      {alignSelf.map((alignSelf, i) => (
        <Box key={i} alignSelf={alignSelf}>
          <slots.child.Component index={i} />
        </Box>
      ))}
    </MuiStack>
  );
}

import {
  AlertDialogContent,
  Button,
  ButtonControl,
  Dialog,
  DialogCommand,
  IconButton,
  MaterialIcon,
  bemClasses,
} from "#design-system";
import {
  ExpressionJson,
  NodeOutputExpressionJson,
  SceneInputExpressionJson,
} from "#shared";
import { CommandController } from "@initiativejs/react-command";
import { JsonLiteralSchema, NodeSchema, t } from "@initiativejs/schema";
import { Children, ReactNode, useContext, useId, useState } from "react";
import { DefinitionsContext } from "../../context.js";
import { ExpressionLhs, generateHelpText } from "./expression-control.js";
import { useSelectedNodeAncestors } from "./use-selected-node-ancestors.js";

const cls = bemClasses("initiative-node-inputs-empty-control");

export interface EmptyControlProps extends ExpressionLhs {
  onSelect(value: ExpressionJson): void;
}

export function EmptyControl({
  parent,
  name,
  expectedType,
  optional,
  doc,
  onSelect,
}: EmptyControlProps) {
  const [controller] = useState(() => new CommandController<DialogCommand>());
  return (
    <>
      <ButtonControl
        label={name}
        helpText={generateHelpText(name, expectedType, optional, doc)}
        errorText={optional ? undefined : `Error: This value is required.`}
        dense={parent === "member-access-expression"}
        adornmentIcon="add"
        emphasized
        value="Choose value ..."
        onPress={() => controller.send("open")}
      />
      <Dialog commandStream={controller}>
        <AlertDialogContent
          className={cls.block()}
          title={
            parent === "node"
              ? `Choose value for input '${name}'`
              : `Choose value for parameter '${name}'`
          }
          actions={
            <Button label="Close" onPress={() => controller.send("close")} />
          }
        >
          <DialogContent expectedType={expectedType} onSelect={onSelect} />
        </AlertDialogContent>
      </Dialog>
    </>
  );
}

interface DialogContentProps {
  expectedType: t.Type;
  onSelect(value: ExpressionJson): void;
}

function DialogContent({ expectedType, onSelect }: DialogContentProps) {
  const ancestors = useSelectedNodeAncestors();

  return (
    <>
      <LiteralsGroup expectedType={expectedType} onSelect={onSelect} />
      {ancestors.map(({ nodeId, slotName, schema }) => (
        <NodeOutputGroup
          key={nodeId}
          nodeId={nodeId}
          slotName={slotName}
          schema={schema}
          expectedType={expectedType}
          onSelect={onSelect}
        />
      ))}
      <div className={cls.element("empty-state")}>No options available.</div>
    </>
  );
}

interface LiteralsGroupProps {
  expectedType: t.Type;
  onSelect(value: ExpressionJson): void;
}

function LiteralsGroup({ expectedType, onSelect }: LiteralsGroupProps) {
  const definitions = useContext(DefinitionsContext);
  const options: ReactNode[] = [];

  if (t.Union.is(expectedType)) {
    for (const element of expectedType.elements) {
      if (
        (t.String.is(element) || t.Number.is(element)) &&
        element.value !== undefined
      ) {
        options.push(
          <EnumValueOption
            key={element.value}
            value={element.value}
            onSelect={onSelect}
          />,
        );
      }
    }
  }
  for (const schema of definitions.jsonLiterals.values()) {
    if (schema.type.isAssignableTo(expectedType)) {
      options.push(
        <JsonLiteralOption
          key={schema.name}
          schema={schema}
          onSelect={onSelect}
        />,
      );
    }
  }

  return options.length === 0 ? null : (
    <Group title="Static value">{options}</Group>
  );
}

interface NodeOutputGroupProps {
  nodeId: string;
  slotName: string;
  schema: NodeSchema;
  expectedType: t.Type;
  onSelect(value: ExpressionJson): void;
}

function NodeOutputGroup({
  nodeId,
  slotName,
  schema,
  expectedType,
  onSelect,
}: NodeOutputGroupProps) {
  const options = schema.forEachOutput(
    (outputName, { type, doc, slot }) =>
      (slot === undefined || slot === slotName) && (
        <TypeOption
          key={outputName}
          label={`.${outputName}`}
          type={type}
          doc={doc}
          expectedType={expectedType}
          expression={{
            type: "node-output",
            nodeId,
            outputName,
            selectors: [],
          }}
          onSelect={onSelect}
        />
      ),
  );
  return options.length === 0 ? null : (
    <Group title={`<${nodeId}>`}>{options}</Group>
  );
}

interface EnumValueOptionProps {
  value: string | number;
  onSelect(value: ExpressionJson): void;
}

function EnumValueOption({ value, onSelect }: EnumValueOptionProps) {
  return (
    <Option
      label={JSON.stringify(value)}
      onSelect={() => onSelect({ type: "enum-value", value })}
    />
  );
}

interface JsonLiteralOptionProps {
  schema: JsonLiteralSchema;
  onSelect(value: ExpressionJson): void;
}

function JsonLiteralOption({ schema, onSelect }: JsonLiteralOptionProps) {
  return (
    <Option
      label={schema.name.split("::")[1]}
      type={schema.type}
      doc={schema.doc}
      onSelect={() =>
        onSelect({
          type: "json-literal",
          schemaName: schema.name,
          value: schema.initialValue(),
        })
      }
    />
  );
}

interface TypeOptionProps {
  label: string;
  type: t.Type;
  doc?: string;
  expectedType: t.Type;
  expression: SceneInputExpressionJson | NodeOutputExpressionJson;
  onSelect(value: ExpressionJson): void;
}

function TypeOption({
  label,
  type,
  doc,
  expectedType,
  expression,
  onSelect,
}: TypeOptionProps) {
  const definitions = useContext(DefinitionsContext);

  return (
    <Option
      label={label}
      isFunctionCall={expression.selectors.at(-1)?.type === "call"}
      type={type}
      doc={doc}
      onSelect={
        type.isAssignableTo(expectedType)
          ? () => onSelect(expression)
          : undefined
      }
    >
      {t.Function.is(type) && (
        <TypeOption
          label={`.call(${t.Function.formatParameterList(type)})`}
          type={type.returnType}
          expectedType={expectedType}
          expression={{
            ...expression,
            selectors: [
              ...expression.selectors,
              { type: "call", args: type.parameters.map(() => null) },
            ],
          }}
          onSelect={onSelect}
        />
      )}
      {Object.entries(type.properties).map(([propertyName, member]) => (
        <TypeOption
          key={propertyName}
          label={`.${propertyName}`}
          type={member.type}
          doc={member.doc}
          expectedType={expectedType}
          expression={{
            ...expression,
            selectors: [
              ...expression.selectors,
              { type: "property", propertyName },
            ],
          }}
          onSelect={onSelect}
        />
      ))}
      {Object.entries(type.methods).map(([methodName, member]) => {
        const methodType = member.type as t.Function;
        return (
          <TypeOption
            key={methodName}
            label={
              `.${methodName}` +
              `(${t.Function.formatParameterList(methodType)})`
            }
            type={methodType.returnType}
            doc={member.doc}
            expectedType={expectedType}
            expression={{
              ...expression,
              selectors: [
                ...expression.selectors,
                {
                  type: "method",
                  methodName,
                  args: methodType.parameters.map(() => null),
                },
              ],
            }}
            onSelect={onSelect}
          />
        );
      })}
      {[...definitions.extensionMethods.values()].map(
        ({ schema }) =>
          type.isAssignableTo(schema.self) && (
            <TypeOption
              key={schema.name}
              label={
                `🅴.${schema.name.split("::")[1]}` +
                `(${t.Function.formatParameterList(schema.type)})`
              }
              type={schema.type.returnType}
              doc={
                `Extension method '${schema.name}' on type '${schema.self}'` +
                (schema.doc ? `\n\n${schema.doc}` : "")
              }
              expectedType={expectedType}
              expression={{
                ...expression,
                selectors: [
                  ...expression.selectors,
                  {
                    type: "extension-method",
                    extensionMethodName: schema.name,
                    args: schema.type.parameters.map(() => null),
                  },
                ],
              }}
              onSelect={onSelect}
            />
          ),
      )}
    </Option>
  );
}

//
// UI components
//

interface GroupProps {
  title: string;
  children: ReactNode;
}

function Group({ title, children }: GroupProps) {
  const [closed, setClosed] = useState(true);
  const buttonId = useId();
  return (
    <div className={cls.element("group")}>
      <IconButton
        className={cls.element("toggle-button")}
        id={buttonId}
        label={closed ? "Expand" : "Collapse"}
        icon={closed ? "arrow_right" : "arrow_drop_down"}
        onPress={() => setClosed(!closed)}
      />
      <label className={cls.element("group-title")} htmlFor={buttonId}>
        {title}
      </label>
      {!closed && <div className={cls.element("children")}>{children}</div>}
    </div>
  );
}

interface OptionProps {
  label: string;
  isFunctionCall?: boolean;
  type?: t.Type;
  doc?: string;
  onSelect?(): void;
  children?: ReactNode;
}

function Option({
  label,
  isFunctionCall,
  type,
  doc,
  onSelect,
  children,
}: OptionProps) {
  const [closed, setClosed] = useState(true);
  return (
    <div className={cls.element("option", null, !onSelect && "disabled")}>
      {Children.toArray(children).length !== 0 && (
        <IconButton
          className={cls.element("toggle-button")}
          label={closed ? "Expand" : "Collapse"}
          icon={closed ? "arrow_right" : "arrow_drop_down"}
          onPress={() => setClosed(!closed)}
        />
      )}
      <div className={cls.element("option-header")} onClick={onSelect}>
        <span
          className={cls.element(
            "option-name",
            null,
            isFunctionCall && "function-call",
          )}
        >
          {label}
          {type && (
            <span className={cls.element("option-type")}>
              : {type.toString()}
            </span>
          )}
        </span>
        {doc && (
          <MaterialIcon
            className={cls.element("option-doc")}
            icon="help_outline"
            title={doc}
          />
        )}
      </div>
      {!closed && <div className={cls.element("children")}>{children}</div>}
    </div>
  );
}

import { Definitions, NodeSchema } from "@initiativejs/schema";
import {
  Expression,
  ExpressionJson,
  MemberAccessExpression,
  ValidateExpressionContext,
} from "./expression.js";
import { Listener, Listeners, Unsubscribe } from "./listeners.js";
import { NodeData, NodeParent } from "./node-data.js";

export type SceneDocumentPatch =
  | CreateNodePatch
  | DeleteNodePatch
  | RenameNodePatch
  | SetNodeInputPatch;

export interface CreateNodePatch {
  readonly type: "create-node";
  readonly nodeType: string;
  readonly parent?: Omit<NodeParent, "index">;
  readonly nodeId?: string;
}

export interface DeleteNodePatch {
  readonly type: "delete-node";
  readonly nodeId: string;
}

export interface RenameNodePatch {
  readonly type: "rename-node";
  readonly nodeId: string;
  readonly newId: string;
}

export interface SetNodeInputPatch {
  readonly type: "set-node-input";
  readonly nodeId: string;
  readonly expression: ExpressionJson | null;
  readonly inputName: string;
  readonly index?: number;
}

interface PatchBuffer {
  time: Date;
  patch: SceneDocumentPatch;
}

export class SceneDocument {
  constructor(
    readonly name: string,
    readonly definitions: Definitions,
  ) {}

  #rootNodeId: string | null = null;
  #nodes = new Map<string, NodeData>();
  #version = 0;
  #patchbuffer: Array<PatchBuffer> = [];

  getRootNodeId(): string | null {
    return this.#rootNodeId;
  }

  hasNode(nodeId: string): boolean {
    return this.#nodes.has(nodeId);
  }

  getVersion(): number {
    return this.#version;
  }

  /**
   * Throws an error if `nodeId` cannot be found.
   */
  getNode(nodeId: string): NodeData {
    const result = this.#nodes.get(nodeId);
    if (result) return result;
    throw new Error(`Node '${nodeId}' not found.`);
  }

  /**
   * Returns the ancestors of `nodeId`, excluding `nodeId` itself, with the root
   * node at index 0.
   */
  getAncestors(nodeId: string): NodeParent[] {
    const result: NodeParent[] = [];
    for (let current = this.getNode(nodeId).parent; current; ) {
      result.push(current);
      current = this.getNode(current.nodeId).parent;
    }
    return result.reverse();
  }

  /**
   * Returns all node ids in this document, in breadth-first iteration order.
   */
  keys(): string[] {
    if (!this.#rootNodeId) return [];

    const result = [this.#rootNodeId];
    for (const nodeId of result) {
      this.#nodes.get(nodeId)!.forEachSlot((childId) => {
        if (childId) result.push(childId);
      });
    }
    return result;
  }

  /**
   * Returns a node id that doesn't exist in this repository.
   */
  #generateNodeId(schema: NodeSchema): string {
    const [, prefix] = schema.name.split("::");
    for (let i = 1; ; i++) {
      const nodeId = `${prefix}${i}`;
      if (!this.#nodes.has(nodeId)) return nodeId;
    }
  }

  getUndo(): SceneDocumentPatch | undefined {
    return this.#patchbuffer.length === 0
      ? undefined
      : this.#patchbuffer[this.#patchbuffer.length - 1].patch;
  }

  undoPatch(): void {
    let recursion: boolean = false;
    if (!this.#patchbuffer.length) return;
    const current = this.#patchbuffer.pop()!;
    if (!current) return;
    const next = this.#patchbuffer[this.#patchbuffer.length - 1];
    switch (current.patch.type) {
      case "create-node":
        this.applyPatch(current.patch, true);
        if (!next) break;
        if (next.patch.type !== "set-node-input") {
          if (next.patch.type !== "create-node") break;
        }
        if (next.time !== current.time) break;
        recursion = true;
        break;
      case "delete-node":
        this.applyPatch(current.patch, true);
        break;
      case "rename-node":
        this.applyPatch(current.patch, true);
        break;
      case "set-node-input":
        this.applyPatch(current.patch, true);
        if (!next) break;
        if (next.patch.type !== "set-node-input") break;
        if (next.time !== current.time) break;
        recursion = true;
        break;
    }
    if (recursion) this.undoPatch();
  }

  applyPatch(patch: SceneDocumentPatch, undopatch?: boolean): void {
    let changedNodeIds: string[];
    switch (patch.type) {
      case "create-node":
        changedNodeIds = patch.parent
          ? this.#createNode(patch, patch.parent)
          : this.#createRootNode(patch);
        if (undopatch) break;
        this.#patchbuffer.push({
          time: new Date(),
          patch: {
            type: "delete-node",
            nodeId: patch.parent ? changedNodeIds[1] : changedNodeIds[0],
          },
        });
        break;
      case "delete-node":
        if (!undopatch) {
          this.#patchbuffer.push(
            ...this.#fillBufferOnDeleteNode(patch.nodeId, new Date()),
          );
        }
        changedNodeIds =
          patch.nodeId === this.#rootNodeId
            ? this.#deleteRootNode()
            : this.#deleteNode(patch);
        break;
      case "rename-node":
        if (!undopatch) {
          this.#patchbuffer.push({
            time: new Date(),
            patch: {
              newId: patch.nodeId,
              nodeId: patch.newId,
              type: "rename-node",
            },
          });
        }
        changedNodeIds = this.#renameNode(patch);
        break;
      case "set-node-input":
        if (
          this.getNode(patch.nodeId).inputs[
            patch.index === undefined
              ? patch.inputName
              : `${patch.inputName}::${patch.index}`
          ] &&
          !undopatch
        ) {
          const previousPatch = this.#patchbuffer.pop();
          if (previousPatch) this.#patchbuffer.push(previousPatch);
          const timestamp = new Date();
          let omitChange: Boolean = false;
          switch (true) {
            case true:
              if (!previousPatch) break;
              if (previousPatch!.patch.type !== "set-node-input") break;
              if (previousPatch!.patch.nodeId !== patch.nodeId) break;
              if (previousPatch!.patch.index !== patch.index) break;
              if (timestamp.getTime() - previousPatch!.time.getTime() > 200)
                break;
            default:
              omitChange = true;
          }
          if (!omitChange) {
            this.#patchbuffer.push({
              time: timestamp,
              patch: {
                type: "set-node-input",
                nodeId: patch.nodeId,
                inputName: patch.inputName,
                index: patch.index,
                expression: this.getNode(patch.nodeId).inputs[
                  patch.index === undefined
                    ? patch.inputName
                    : `${patch.inputName}::${patch.index}`
                ]?.toJson(),
              },
            });
          }
        }
        changedNodeIds = this.#setNodeInput(patch);
        break;
    }
    this.#version++;
    this.#changeListeners.notify(changedNodeIds);
    this.#patchListeners.notify(patch);
    console.log("Buffer: ", this.#patchbuffer);
  }

  #fillBufferOnDeleteNode(nodeId: string, timestamp: Date): Array<PatchBuffer> {
    const output: Array<PatchBuffer> = new Array();
    if (!nodeId) return output;
    output.push(...this.#bufferRecreateInputs(nodeId, timestamp));
    output.push(...this.#bufferRecreateNodes(nodeId, timestamp).reverse());
    return output;
  }
  #bufferRecreateNodes(
    nodeId: string | null,
    timestamp: Date,
  ): Array<PatchBuffer> {
    const output: Array<PatchBuffer> = new Array();
    if (!nodeId) return output;
    const node: NodeData = this.getNode(nodeId);
    output.push({
      time: timestamp,
      patch: {
        type: "create-node",
        nodeType: node.type,
        parent: { index: undefined, ...node.parent! },
        nodeId: nodeId,
      },
    });
    output.push(
      ...node
        .forEachSlot((childId) => this.#bufferRecreateNodes(childId, timestamp))
        .flat(1),
    );
    return output;
  }
  #bufferRecreateInputs(
    nodeId: string | null,
    timestamp: Date,
  ): Array<PatchBuffer> {
    const output: Array<PatchBuffer> = new Array();
    if (!nodeId) return output;
    const node: NodeData = this.getNode(nodeId);
    output.push(
      ...node
        .forEachSlot((childId) =>
          this.#bufferRecreateInputs(childId, timestamp),
        )
        .flat(1),
    );
    output.reverse();
    const nodeInputs: Array<PatchBuffer> = node.forEachInput(
      (expression, attributes, inputName, index) => ({
        time: timestamp,
        patch: {
          type: "set-node-input",
          nodeId: nodeId,
          inputName: inputName,
          index: index,
          expression: expression ? expression.toJson() : null,
        },
      }),
    );
    nodeInputs.reverse();
    output.push(...nodeInputs);
    return output;
  }

  #createRootNode({ nodeType, nodeId }: CreateNodePatch): string[] {
    if (this.#rootNodeId !== null) {
      throw new Error("SceneDocument is not empty.");
    }
    const { schema } = this.definitions.getNode(nodeType);
    nodeId ??= this.#generateNodeId(schema);

    this.#nodes.set(nodeId, NodeData.empty(schema, nodeId, null));
    this.#rootNodeId = nodeId;

    return [nodeId];
  }

  #createNode(
    { nodeType, nodeId: childId }: CreateNodePatch,
    { nodeId: parentId, slotName }: Omit<NodeParent, "index">,
  ): string[] {
    const { schema } = this.definitions.getNode(nodeType);
    childId ??= this.#generateNodeId(schema);
    if (this.#nodes.has(childId)) {
      throw new Error(`A node with id '${childId}' already exists.`);
    }

    const [parentNode, movedChildren] = this.getNode(parentId).addChild(
      childId,
      slotName,
    );
    const newChild = NodeData.empty(schema, childId, movedChildren[childId]);
    this.#nodes.set(parentId, parentNode);
    for (const [childId, nodeParent] of Object.entries(movedChildren)) {
      this.#nodes.set(
        childId,
        this.#nodes.get(childId)?.move(nodeParent) ?? newChild,
      );
    }

    return [parentId, childId];
  }

  #deleteRootNode(): string[] {
    const nodeIds = [...this.#nodes.keys()];
    this.#rootNodeId = null;
    this.#nodes.clear();

    return nodeIds;
  }

  #deleteNode({ nodeId }: DeleteNodePatch): string[] {
    const node = this.getNode(nodeId);
    const [parentNode, movedChildren] = this.#nodes
      .get(node.parent!.nodeId)!
      .removeChild(node.parent!.slotName, node.parent!.index);

    const changedIds = [parentNode.id, nodeId];
    this.#nodes.set(parentNode.id, parentNode);
    for (const [childId, nodeParent] of Object.entries(movedChildren)) {
      changedIds.push(childId);
      this.#nodes.set(childId, this.#nodes.get(childId)!.move(nodeParent));
    }

    const deletedNodeIds = [node.id];
    for (const nodeId of deletedNodeIds) {
      changedIds.push(nodeId);
      this.#nodes.get(nodeId)!.forEachSlot((childId) => {
        if (childId) deletedNodeIds.push(childId);
      });
      this.#nodes.delete(nodeId);
    }

    return changedIds;
  }

  #renameNode({ nodeId: oldId, newId }: RenameNodePatch): string[] {
    if (this.#nodes.has(newId)) {
      throw new Error(`A node with id '${newId}' already exists.`);
    }
    const oldNode = this.getNode(oldId);
    const [newNode, movedChildren] = oldNode.rename(newId);
    this.#nodes.delete(oldId);
    this.#nodes.set(newId, newNode);

    const changedIds = [oldId, newId];

    if (oldNode.parent) {
      const { nodeId, slotName, index } = oldNode.parent;
      changedIds.push(nodeId);
      this.#nodes.set(
        nodeId,
        this.#nodes.get(nodeId)!.renameChild(newId, slotName, index),
      );
    } else {
      this.#rootNodeId = newId;
    }

    for (const [childId, parent] of Object.entries(movedChildren)) {
      this.#nodes.set(childId, this.#nodes.get(childId)!.move(parent));
      this.#updateNodeAfterAncestorRename(oldId, newId, childId, changedIds);
      if (!changedIds.includes(childId)) changedIds.push(childId);
    }

    return changedIds;
  }

  /**
   * Replaces all references to `oldAncestorId` with `newAncestorId` in
   * `"node-output"` inputs of `node`, then updates `node` in `#nodes`.
   *
   * Adds `node` to `changedIds` in-place. Recurses into the children of `node`.
   */
  #updateNodeAfterAncestorRename(
    oldAncestorId: string,
    newAncestorId: string,
    nodeId: string,
    changedIds: string[],
  ): void {
    const oldNode = this.#nodes.get(nodeId)!;
    let newNode = oldNode;
    const ctx = this.#createValidateExpressionContext(oldNode);
    oldNode.forEachInput((oldExpression, { type }, inputName, index) => {
      if (!(oldExpression instanceof MemberAccessExpression)) return;
      const newExpression = oldExpression.replaceNodeOutput(
        oldAncestorId,
        newAncestorId,
      );
      if (!newExpression) return;

      newNode = newNode.setInput(
        Expression.fromJson(newExpression, type, ctx),
        inputName,
        index,
      );
    });

    if (oldNode !== newNode) {
      this.#nodes.set(nodeId, newNode);
      changedIds.push(nodeId);
    }

    oldNode.forEachSlot((childId) => {
      if (!childId) return;
      this.#updateNodeAfterAncestorRename(
        oldAncestorId,
        newAncestorId,
        childId,
        changedIds,
      );
    });
  }

  #setNodeInput({
    nodeId,
    expression,
    inputName,
    index,
  }: SetNodeInputPatch): string[] {
    const oldNode = this.getNode(nodeId);
    const newNode = oldNode.setInput(
      expression &&
        Expression.fromJson(
          expression,
          oldNode.schema.getInputAttributes(inputName).type,
          this.#createValidateExpressionContext(oldNode),
        ),
      inputName,
      index,
    );
    this.#nodes.set(nodeId, newNode);

    return [nodeId];
  }

  #createValidateExpressionContext(
    node: Pick<NodeData, "parent">,
    // newNodes?: ReadonlyMap<string, NodeData>
  ): ValidateExpressionContext {
    return {
      getJsonLiteralSchema: (schemaName) => {
        return this.definitions.getJsonLiteral(schemaName);
      },
      getExtensionMethodDefinition: (schemaName) => {
        return this.definitions.getExtensionMethod(schemaName);
      },
      getNodeOutputType: (nodeId, outputName) => {
        let { parent } = node;
        while (parent) {
          const parentNode = this.#nodes.get(parent.nodeId)!;
          if (parent.nodeId !== nodeId) {
            parent = parentNode.parent;
            continue;
          }

          const { type, slot } =
            parentNode.schema.getOutputAttributes(outputName);
          if (slot && slot !== parent.slotName) {
            throw new Error(
              `Output '${nodeId}::${outputName}' is not exposed to this node.`,
            );
          }
          return type;
        }
        throw new Error(`Node '${nodeId}' is not an ancestor of this node.`);
      },
      getSceneInputType: (inputName) => {
        throw new Error("Unimplemented");
      },
    };
  }

  //
  // Listeners
  //

  #changeListeners = new Listeners<readonly string[]>();
  #patchListeners = new Listeners<SceneDocumentPatch>();

  listen(type: "change", listener: Listener<readonly string[]>): Unsubscribe;
  listen(type: "patch", listener: Listener<SceneDocumentPatch>): Unsubscribe;
  listen(type: "change" | "patch", listener: any): Unsubscribe {
    switch (type) {
      case "change":
        return this.#changeListeners.add(listener);
      case "patch":
        return this.#patchListeners.add(listener);
      default:
        throw new Error(`Invalid type '${type}'.`);
    }
  }
}

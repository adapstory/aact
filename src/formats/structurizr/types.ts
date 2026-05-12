// Structurizr JSON/DSL vocabulary — values as they appear in workspace.json
export const STRUCTURIZR_LOCATION_EXTERNAL = "External";
export const STRUCTURIZR_INTERACTION_ASYNC = "Asynchronous";
export const STRUCTURIZR_TAG_ASYNC = "async";

export interface StructurizrWorkspace {
  id?: number;
  name: string;
  description?: string;
  model: StructurizrModel;
}

interface StructurizrModel {
  enterprise?: { name: string };
  people?: StructurizrPerson[];
  softwareSystems?: StructurizrSoftwareSystem[];
}

export interface StructurizrProperties {
  "structurizr.dsl.identifier"?: string;
  [key: string]: string | undefined;
}

export interface StructurizrPerson {
  id: string;
  name: string;
  description?: string;
  tags?: string;
  properties?: StructurizrProperties;
  relationships?: StructurizrRelationship[];
}

export interface StructurizrSoftwareSystem {
  id: string;
  name: string;
  description?: string;
  location?: "External" | "Internal" | "Unspecified";
  tags?: string;
  properties?: StructurizrProperties;
  containers?: StructurizrContainer[];
  relationships?: StructurizrRelationship[];
}

export interface StructurizrContainer {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  tags?: string;
  properties?: StructurizrProperties;
  components?: StructurizrComponent[];
  relationships?: StructurizrRelationship[];
}

interface StructurizrComponent {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  tags?: string;
  properties?: StructurizrProperties;
  relationships?: StructurizrRelationship[];
}

export interface StructurizrRelationship {
  id: string;
  description?: string;
  sourceId: string;
  destinationId: string;
  technology?: string;
  interactionStyle?: "Synchronous" | "Asynchronous";
  tags?: string;
}

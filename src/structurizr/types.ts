export interface StructurizrWorkspace {
  id?: number;
  name: string;
  description?: string;
  model: StructurizrModel;
}

export interface StructurizrModel {
  enterprise?: { name: string };
  people?: StructurizrPerson[];
  softwareSystems?: StructurizrSoftwareSystem[];
}

export interface StructurizrPerson {
  id: string;
  name: string;
  description?: string;
  tags?: string;
  relationships?: StructurizrRelationship[];
}

export interface StructurizrSoftwareSystem {
  id: string;
  name: string;
  description?: string;
  location?: "External" | "Internal" | "Unspecified";
  tags?: string;
  containers?: StructurizrContainer[];
  relationships?: StructurizrRelationship[];
}

export interface StructurizrContainer {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  tags?: string;
  components?: StructurizrComponent[];
  relationships?: StructurizrRelationship[];
}

export interface StructurizrComponent {
  id: string;
  name: string;
  description?: string;
  technology?: string;
  tags?: string;
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

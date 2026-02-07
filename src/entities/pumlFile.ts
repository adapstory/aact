import { Boundary } from "./boundary";
import { Container } from "./container";

export interface PumlFile {
  readonly boundaries: Boundary[];
  readonly allContainers: Container[];
}

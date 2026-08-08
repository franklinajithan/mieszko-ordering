export type Store = {
  id: number;
  code: string;
  name: string;
  erpType: string;
  isActive: boolean;
};

/** Dropdown / import form props — full row not required. */
export type StoreOption = Pick<Store, "id" | "name" | "code" | "erpType">;

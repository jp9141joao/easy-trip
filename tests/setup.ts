/**
 * Test setup.
 *
 * Native modules are replaced with in-memory equivalents so the domain and
 * repository layers can be exercised in Node without a device.
 */

/* ------------------------------ AsyncStorage ------------------------------ */

jest.mock('@react-native-async-storage/async-storage', () => {
  let store: Record<string, string> = {};
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store[key] ?? null),
      setItem: jest.fn(async (key: string, value: string) => {
        store[key] = value;
      }),
      removeItem: jest.fn(async (key: string) => {
        delete store[key];
      }),
      getAllKeys: jest.fn(async () => Object.keys(store)),
      multiRemove: jest.fn(async (keys: string[]) => {
        keys.forEach((key) => delete store[key]);
      }),
      clear: jest.fn(async () => {
        store = {};
      }),
    },
  };
});

/* -------------------------------- SecureStore ----------------------------- */

jest.mock('expo-secure-store', () => {
  const store: Record<string, string> = {};
  return {
    getItemAsync: jest.fn(async (key: string) => store[key] ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      delete store[key];
    }),
  };
});

/* ---------------------------------- Crypto -------------------------------- */

jest.mock('expo-crypto', () => {
  let counter = 0;
  return {
    randomUUID: jest.fn(() => {
      counter += 1;
      return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
    }),
    digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `hashed:${value}`),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  };
});

/* ------------------------------- File system ------------------------------ */

jest.mock('expo-file-system', () => {
  class FakeDirectory {
    uri: string;
    exists = true;
    constructor(...segments: unknown[]) {
      this.uri = segments.map(String).join('/');
    }
    create() {}
    delete() {}
  }
  class FakeFile {
    uri: string;
    exists = true;
    constructor(...segments: unknown[]) {
      this.uri = segments.map((s) => (s instanceof FakeDirectory ? s.uri : String(s))).join('/');
    }
    async copy() {}
    delete() {}
    async arrayBuffer() {
      return new ArrayBuffer(0);
    }
  }
  return {
    Directory: FakeDirectory,
    File: FakeFile,
    Paths: { document: new FakeDirectory('file:///documents'), cache: new FakeDirectory('file:///cache') },
  };
});

/* --------------------------------- Silence -------------------------------- */

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(async () => undefined),
  selectionAsync: jest.fn(async () => undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));

/* --------------------------------- Ícones --------------------------------- */

// `lucide-react-native` só publica ESM (.mjs), que o transform do jest-expo não
// cobre. Os ícones são decorativos, então um stub basta para que os componentes
// que os usam possam ser renderizados em teste.
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

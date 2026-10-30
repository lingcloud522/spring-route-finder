# Spring Route Finder

Jump from an API path such as `api/v1/auth/login` straight to the Spring Controller
method that implements it.

## Why

A Spring URL is assembled from a class level annotation and a method level one:

```java
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    @PostMapping("/login")
    public LoginResponse login(LoginRequest request) {
        // ...
    }
}
```

The full path `api/v1/auth/login` never appears as a single string in the source, so
full-text search cannot find it. You either know which controller owns the prefix or you
start hunting through the code. This extension indexes every route in the workspace and
resolves a path back to its handler.

## Features

- **Search by path** - `Cmd+Alt+J` (`Ctrl+Alt+J` on Windows and Linux) opens a fuzzy
  search over every route. Each entry shows the HTTP method, the handler method and
  `file:line`; pressing Enter jumps to the declaration.
- **Search from a selection** - select a path anywhere, such as a log line, a `fetch()`
  call or an API document, and press `Cmd+Alt+Shift+J`. Host name, query string and
  trailing path segments are stripped automatically.
- **Status bar entry** - the indexed route count sits in the status bar; click it to open
  the search.
- **Automatic refresh** - saving a Java file invalidates the index, which is rebuilt the
  next time you use it.
- **Constant resolution** - understands same-file `static final String` constants,
  interface constants and cross-file references such as `ApiPaths.LOGIN`.

## Install

Search for `Spring Route Finder` in the Extensions view, or run:

```bash
code --install-extension LingCloud.spring-route-finder
```

Requires VS Code 1.80 or newer. Works on Windows, macOS and Linux.

## Usage

| Action | Shortcut (macOS / Windows·Linux) |
| --- | --- |
| Find implementation by API path | `Cmd+Alt+J` / `Ctrl+Alt+J` |
| Find implementation from selection | `Cmd+Alt+Shift+J` / `Ctrl+Alt+Shift+J` |
| Rebuild route index | Command palette: `Spring Route Finder: Rebuild Route Index` |

Both commands are also available from the command palette (`Cmd+Shift+P`).

Matching is fuzzy and covers the path, the HTTP method and the handler name, so
`api/v1/auth/login`, `auth login` and `login` all lead to the same route. Routes are
listed in path order, and the HTTP method plus handler name make it easy to tell similar
endpoints apart.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `springRouteFinder.sourceRoots` | `["**/src/main/java"]` | Glob patterns, relative to each workspace folder, to scan for Java sources |
| `springRouteFinder.exclude` | target, build, out, node_modules, generated | Directories excluded from indexing |
| `springRouteFinder.maxFiles` | `20000` | Maximum number of Java files to index |
| `springRouteFinder.maxFileSizeKb` | `1024` | Skip files larger than this (`0` disables the limit) |
| `springRouteFinder.maxTotalSizeMb` | `256` | Stop reading after this much source per index run (`0` disables the limit) |

The index is built on first use and reports progress. If files are skipped or the size
limit is reached, the extension tells you which setting to raise.

## What is indexed

Supported annotations: `@RequestMapping`, `@GetMapping`, `@PostMapping`, `@PutMapping`,
`@DeleteMapping`, `@PatchMapping`.

Supported forms:

- Class level and method level multi-path values, such as `@RequestMapping({"/internal/auth", "/admin/auth"})`
- `@RequestMapping(method = RequestMethod.POST)`
- `value`, `path` and positional arguments, including arrays such as `{"/login", "/sign-in"}`
- Same-file `static final String` constants, interface constants and cross-file references such as `ApiPaths.LOGIN`

Not supported:

- Bare constants pulled in with `static import`, and paths assembled at runtime
- Paths declared on `@FeignClient` interfaces
- Mappings declared inside nested classes

Path segments that cannot be resolved are shown as `*` and stay searchable through the
rest of the path. For safety the parser only looks for the handler inside a bounded
window after the annotation (40 lines, 4000 characters) and skips files larger than
`maxFileSizeKb`; real code declares the handler right after its annotation, so normal
projects are unaffected.

## Privacy

The extension reads Java files inside your workspace to build the index and nothing else.
Nothing is uploaded or shared, no usage data is collected, and it makes no network
requests, so it works fully offline. Workspace Trust is supported, which means it also
runs in Restricted Mode.

## License

MIT. See the `LICENSE` file.

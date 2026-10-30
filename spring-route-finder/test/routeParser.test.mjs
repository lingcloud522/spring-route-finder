import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { collectConstantTable, makeResolver, resolveRoutes, scanJavaFile } = require(
  '../out/routeParser.js'
);

function routesOf(...sources) {
  const scans = sources.map((source) => scanJavaFile(source));
  const table = collectConstantTable(scans);
  return scans.flatMap((scan) => resolveRoutes(scan, makeResolver(table, scan.constants)));
}

function lineOf(source, marker) {
  return source.slice(0, source.indexOf(marker)).split('\n').length;
}

const authController = `package com.demo;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    @PostMapping("/login")
    public LoginResponse login(LoginRequest request) {
        return authService.login(request);
    }
}
`;

test('joins the class level prefix with the method path and reports the handler line', () => {
  const routes = routesOf(authController);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].fullPath, '/api/v1/auth/login');
  assert.equal(routes[0].httpMethod, 'POST');
  assert.equal(routes[0].handler, 'login');
  assert.equal(routes[0].line, lineOf(authController, 'public LoginResponse login'));
});

test('strings in produces, consumes and headers are not treated as paths', () => {
  const routes = routesOf(`@RestController
@RequestMapping(value = "/api/v1/users", produces = "application/json", consumes = {"text/plain"})
public class UserController {

    @GetMapping(value = {"/{id}", "/by-name/{name}"}, headers = "X-Tenant=1")
    public UserProfile getUser(Long id) {
        return null;
    }
}
`);
  assert.deepEqual(
    routes.map((route) => route.fullPath).sort(),
    ['/api/v1/users/by-name/{name}', '/api/v1/users/{id}']
  );
});

test('expands multi-path values on both class and method level', () => {
  const routes = routesOf(`@RestController
@RequestMapping({"/internal/auth", "/admin/auth"})
public class AuthAdminController {

    @DeleteMapping({"/logout", "/revoke"})
    public void logout(Long userId) {
    }
}
`);
  assert.equal(routes.length, 4);
  assert.ok(routes.every((route) => route.httpMethod === 'DELETE'));
  assert.ok(routes.some((route) => route.fullPath === '/admin/auth/revoke'));
});

test('detects the HTTP method from a RequestMapping method attribute', () => {
  const routes = routesOf(`@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    @RequestMapping(value = "/search", method = RequestMethod.POST)
    public Page searchUsers(UserQuery query) {
        return null;
    }
}
`);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].httpMethod, 'POST');
  assert.equal(routes[0].fullPath, '/api/v1/users/search');
});

test('methods without a class level prefix are mapped at the root', () => {
  const routes = routesOf(`@RestController
public class HealthController {

    @GetMapping("/health")
    public String health() {
        return "ok";
    }
}
`);
  assert.deepEqual(routes.map((route) => route.fullPath), ['/health']);
});

test('resolves same-file static final constants', () => {
  const routes = routesOf(`@RestController
@RequestMapping(BASE)
public class AuthController {

    private static final String BASE = "/api/v1/auth";
    private static final String LOGIN = "/login";

    @PostMapping(LOGIN)
    public LoginResponse login() {
        return null;
    }
}
`);
  assert.deepEqual(routes.map((route) => route.fullPath), ['/api/v1/auth/login']);
});

test('resolves interface constants and cross-file references', () => {
  const routes = routesOf(
    `public interface ApiPaths {
    String USERS = "/api/v1/users";
    String USER_DETAIL = "/{id}";
}
`,
    `@RestController
@RequestMapping(ApiPaths.USERS)
public class UserController {

    @GetMapping(ApiPaths.USER_DETAIL)
    public UserProfile getUser() {
        return null;
    }
}
`
  );
  assert.deepEqual(routes.map((route) => route.fullPath), ['/api/v1/users/{id}']);
});

test('unresolved constants do not produce phantom routes', () => {
  const routes = routesOf(`@RestController
@RequestMapping(UnknownPaths.USERS)
public class UnknownController {

    @PostMapping(UnknownPaths.LOGIN)
    public void login() {
    }
}
`);
  assert.deepEqual(routes, []);
});

test('ignores mappings inside comments and strings', () => {
  const routes = routesOf(`@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    // @PostMapping("/ghost")
    /*
     * @PostMapping("/ghost2")
     */
    @PostMapping("/login")
    public String login() {
        String sample = "@PostMapping(\\"/fake\\")";
        return sample;
    }
}
`);
  assert.deepEqual(routes.map((route) => route.fullPath), ['/api/v1/auth/login']);
});

test('skips mappings in nested classes while indexing the outer methods', () => {
  const routes = routesOf(`@RestController
@RequestMapping("/outer")
public class OuterController {

    @GetMapping("/a")
    public String a() {
        return "a";
    }

    static class Inner {
        @GetMapping("/b")
        public String b() {
            return "b";
        }
    }
}
`);
  assert.deepEqual(routes.map((route) => route.fullPath), ['/outer/a']);
});

test('extra annotations on the method do not break handler detection', () => {
  const source = `@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    @PostMapping("/login")
    @Override
    @Transactional
    public final LoginResponse login(LoginRequest request) {
        return null;
    }
}
`;
  const routes = routesOf(source);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].handler, 'login');
  assert.equal(routes[0].line, lineOf(source, 'public final LoginResponse login'));
});

test('handles generic return types, array types and same-line declarations', () => {
  const source = `@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    @GetMapping("/list")
    public Map<String, List<UserSummary>> list(
            UserQuery query) {
        return null;
    }

    @PostMapping("/batch") public String[] batch() {
        return null;
    }
}
`;
  const routes = routesOf(source);
  assert.deepEqual(routes.map((route) => route.handler).sort(), ['batch', 'list']);
  assert.equal(
    routes.find((route) => route.handler === 'batch').line,
    lineOf(source, '@PostMapping("/batch") public String[] batch')
  );
});

test('stops guessing when the declaration is far from the annotation', () => {
  const padding = Array.from({ length: 60 }, (_, index) => `    // filler line ${index}`).join('\n');
  const routes = routesOf(`@RestController
@RequestMapping("/api/v1/auth")
public class FarController {

    @PostMapping("/far")
${padding}
    public void far() {
    }
}
`);
  assert.deepEqual(routes, []);
});

test('does not mistake a field initializer for the handler method', () => {
  const routes = routesOf(`@RestController
@RequestMapping("/api/v1/auth")
public class FieldController {

    @PostMapping("/x")
    private final Handler handler = new Handler();
}
`);
  assert.deepEqual(routes, []);
});

test('malformed input does not trigger quadratic backtracking', () => {
  const annotations = 20;
  const filler = 'a'.repeat(20000);
  let crafted = '@RestController\n@RequestMapping("/api/v1/auth")\nclass Slow {\n';
  for (let index = 0; index < annotations; index++) {
    crafted += `    @PostMapping("/p${index}")\n    ${filler}\n`;
  }
  crafted += '}\n';

  const started = Date.now();
  const routes = routesOf(crafted);
  const elapsed = Date.now() - started;

  assert.deepEqual(routes, []);
  assert.ok(
    elapsed < 2000,
    `crafted ${(crafted.length / 1024).toFixed(0)}KB sample took ${elapsed}ms, looks like backtracking`
  );
});

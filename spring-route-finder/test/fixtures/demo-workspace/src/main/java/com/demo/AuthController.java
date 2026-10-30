package com.demo;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    @PostMapping("/login")
    public LoginResponse login(LoginRequest request) {
        return null;
    }

    @PostMapping(ApiPaths.LOGOUT)
    public void logout(String token) {
    }
}

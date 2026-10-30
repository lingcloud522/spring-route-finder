package com.demo.target;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/ghost")
public class GhostController {

    @GetMapping("/should-not-be-indexed")
    public String ghost() {
        return "ghost";
    }
}

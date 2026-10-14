# 安全指南

## 强制安全检查

每次提交前：

- [ ] 无硬编码密钥（API 密钥、数据库密码、令牌、accessKey）
- [ ] 使用 Jasypt 加密配置中的敏感信息
- [ ] SQL 注入防护（使用 MyBatis Plus 参数化查询，禁止拼接 SQL）
- [ ] 所有用户输入已校验（@NotBlank、@Size、@Pattern 等注解）
- [ ] 接口鉴权正确（SSO 拦截器配置、接口权限注解）
- [ ] 错误信息不泄露敏感数据（全局异常处理器统一返回）
- [ ] 日志不打印敏感信息（密码、令牌等需脱敏）
- [ ] 文件上传类型和大小已校验

## 密钥管理

```java
// 禁止: 硬编码密钥
@Value("${jasypt.encryptor.password}")
private String encryptorPassword;

// 正确: 配置文件使用 Jasypt 加密
// application.yaml: datasource.password = ENC(加密后的密文)

// 正确: 密钥从环境变量获取
// 启动参数: -Djasypt.encryptor.password=${JASYPT_PASSWORD}
```

## Java 安全要点

### SQL 注入防护
```java
// 禁止: 拼接 SQL
"SELECT * FROM user WHERE name = '" + name + "'"

// 正确: MyBatis Plus 参数化查询
QueryWrapper<User> wrapper = new QueryWrapper<>();
wrapper.eq("name", name);
userMapper.selectOne(wrapper);

// 正确: XML 中使用 #{} 而非 ${}
// WHERE name = #{name}  ✅
// WHERE name = '${name}'  ❌
```

### 输入校验
```java
@Data
public class UserCreateDTO {
    @NotBlank(message = "用户名不能为空")
    @Size(min = 2, max = 20, message = "用户名长度2-20")
    @Pattern(regexp = "^[a-zA-Z0-9_]+$", message = "用户名只能包含字母数字和下划线")
    private String username;
}
```

### 敏感信息脱敏
```java
// 日志中禁止打印敏感信息
log.info("用户信息: {}", user);  // ❌ User 包含密码字段

// 正确: 脱敏后打印
log.info("用户操作: userId={}", user.getId());  // ✅
```

## 安全响应协议

如果发现安全问题：

1. 立即停止当前操作，向用户说明问题
2. **等用户指令**决定是否启动 security-reviewer 审查
3. 用户确认后修复关键/高危问题
4. 轮换任何泄露的密钥
5. 审查整个代码库是否存在类似问题（同样需用户确认）

> 不要自行启动 security-reviewer，除非用户明确要求。

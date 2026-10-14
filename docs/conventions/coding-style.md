# 编码风格

## 最高优先级规则

1. **除非特别说明否则不要创建文档、不需要总结、不编写测试、不执行测试**。
2. **禁止自动提交代码**，所有代码提交需用户明确指示。
3. **不要自动 review**，等用户指令。
4. 方法需要添加注释，包括方法注释，行注释可选，不需要有很多注释。
5. **每次交互结尾都必须调用 AskUserQuestion 确认**。

## 注释规范（重要）

### 去 AI 化

注释和日志里**不要出现**这些词：

| 禁止 | 原因 |
|------|------|
| 需求/设计文档编号（`E03`、`C1`、`G3`、`D8`、`REQ_GEN_STATUS`、`4.4.6`、`P0.6 坑 4`） | 编号随文档改版失效，读代码的人手上未必有文档 |
| 「契约」「指标」「口径」「基线」「对齐」「兜底」「闭环」「赋能」 | 空词，不传达信息 |
| 「本次」「本轮」「接下来」「值得注意的是」「需要说明的是」 | 废话 |
| 对代码行为的复述（`// 设置状态`、`// 遍历列表`） | 复述代码在做什么，没有信息量 |

### 正确做法

注释解释**为什么这样写**，用业务语言展开规则本身：

```java
// 错误：编号 + 空词
// E03 联动：同 PO+SKU 的行一并完成（规格书 6.6 口径）

// 错误：复述代码
// 设置状态为已完成
requirement.setStatus(COMPLETED);

// 正确：展开规则，说明为什么
// 同一批箱唛文件对应的需求行要一起完成，否则用户看到部分完成会重复触发
```

写注释前问自己：**半年后接手的人读这句能懂吗**？不懂就展开。

## 代码分层

### Controller 层
- 必须保持轻薄，不能编写大量业务逻辑
- 只做参数校验和路由转发，调用 Service
- 返回统一格式：`R.ok(...)`
- **`@PostMapping` 尽量用 `@RequestBody` 入参**（对象形态）。多参数时封装成 DTO，
  不要散成多个 `@RequestParam`；文件上传用 DTO 承载 `MultipartFile` 字段，
  由 Spring 从 multipart 表单绑定

### Service 层
- 所有业务逻辑必须写在 Service 层
- DTO 可以直接透传到 Service，不要在 Service 中重新创建 DTO
- 方法不要超过 2 个入参，多个入参使用参数对象

### 获取当前用户
**先判断服务角色**，再决定怎么取。

**一、无状态的被调服务**（下载中心、导入中心这类被 BFF/业务后端通过 Client 调用的服务）
不取上下文。请求里只有 apiSecret / traceId / greyVersion，没有登录态。
`tenantId`、`createBy`、数据权限的 `createByList` 全部作为 DTO 字段由调用方传入：

```java
// 中心侧：从 DTO 取，不碰 request 和上下文
public XxxVO getXxx(XxxAccessDTO dto) {
    // 租户与数据权限条件下沉到 SQL，不把无权访问的数据读进内存
    Xxx xxx = xxxMapper.getAccessible(dto.getId(), dto.getTenantId(), dto.getCreateByList());
}
```

```java
// Client 侧（在 starter 里）：租户与操作人从上下文填充，不接受调用方传入，避免伪造
public XxxVO getXxx(XxxAccessDTO dto) {
    dto.setTenantId(SecurityUtils.getTenantId());
    return this.postForData(PATH_XXX, dto, typeRef);
}
```

```java
// 调用方（mgt-web / 业务后端 Controller）：算数据权限后传入
List<Long> userIds = DataPermissionUtil.getUserIds("sys_xxx");
// 含 -1L 表示无任何权限，直接返回空
dto.setCreateByList(userIds);
```

**二、直接面向前端的服务**（有登录态的服务）
优先 `SecurityContextHolder`（`com.lingyi.common.context`），静态调用，不需要注入：

```java
Long userId = SecurityContextHolder.getUserId();
Long tenantId = SecurityContextHolder.getTenantId();
```

前提：上下文由 `HeaderFilter` 填充，它在 `lingyi-spring-boot-starter-security` 里。
判断方式：`mvn dependency:tree | grep starter-security`。

**陷阱**：`SecurityContextHolder.getTenantId()` 取不到时返回 `0L` 而不是 `null`
（`Convert.toLong(get(...), 0L)`）。没有 filter 的服务里用它不会报错，而是拿到 0 静默查空，
比抛异常更难排查。所以不能靠判空来兼容两种环境。

没有 starter-security 时退回 `HttpServletRequest`，禁止从 Controller 传入：

```java
@Resource
private HttpServletRequest request;

public void someMethod() {
    SsoUser ssoUser = (SsoUser) request.getAttribute(Conf.SSO_USER);
    Long userId = ssoUser.getUserId();
}
```

同一个服务内只用一种方式，不要两套并存。

### 租户条件不要冗余

租户拦截器（`TenantLineInnerInterceptor` + 白名单）会自动给白名单表加 `tenant_id` 条件。
**查询/更新白名单表时不要再手写 `.eq(Xxx::getTenantId, ...)`**：

```java
// 错误：租户拦截器已经会加，重复
requirementMapper.selectById(id);
// 又或者
requirementMapper.selectOne(new LambdaQueryWrapper<Xxx>()
        .eq(Xxx::getTenantId, tenantId)
        .eq(Xxx::getId, id));

// 正确：拦截器负责隔离
requirementMapper.selectById(id);
```

**例外**（仍需显式带租户）：
- 表**不在**白名单内（拦截器不生效）
- 批量操作的「查回条数 ≠ 请求条数即整批拒绝」防御（这里需要知道少查了哪条）
- 无租户上下文的链路（定时任务、回调）里想主动限制到某个租户

### 业务判定放枚举，不要放常量类

一个值属于某个枚举的语义（如「首单类标记」「终态」「可编辑」），判定方法写在**枚举内**：

```java
// 错误：常量类里堆判定
public class XxxConstants {
    public static final List<CommodityMark> AUTO_PUSH_MARKS =
            Arrays.asList(CommodityMark.FIRST_ORDER, CommodityMark.SUPPLIER_FIRST_ORDER);
}
// 调用处
if (AUTO_PUSH_MARKS.contains(mark)) { ... }

// 正确：枚举自带判定
public enum CommodityMark {
    FIRST_ORDER("FIRST_ORDER", "商品首单"),
    SUPPLIER_FIRST_ORDER("SUPPLIER_FIRST_ORDER", "供应商商品首单"),
    OTHER("OTHER", "其他"),
    ;

    /** 是否为首单类标记，自动推送的依据 */
    public boolean isFirstOrder() {
        return this == FIRST_ORDER || this == SUPPLIER_FIRST_ORDER;
    }
}
// 调用处
if (mark != null && mark.isFirstOrder()) { ... }
```

常量类只放**格式、分隔符、限额、固定文案**。

## 不可见的 import 管理

不要出现无效的 import，每次编辑后检查 import 语句。

## MyBatis Plus 链式调用规范

LambdaQueryWrapper、lambdaUpdate 等方法调用**禁止**嵌入方法参数中，必须先提取为变量再调用。**入参少（1-2个简单条件）的除外**，可直接内联使用：

```java
// 错误: 复杂条件内嵌链式调用
xxxMapper.selectList(new LambdaQueryWrapper<Xxx>()
        .eq(Xxx::getId, id)
        .orderByAsc(Xxx::getSortOrder));

// 正确: 提取为变量
LambdaQueryWrapper<Xxx> wrapper = new LambdaQueryWrapper<Xxx>()
        .eq(Xxx::getId, id)
        .orderByAsc(Xxx::getSortOrder);
List<Xxx> list = xxxMapper.selectList(wrapper);

// 允许: 单条件内联
xxxMapper.selectOne(new LambdaQueryWrapper<Xxx>().eq(Xxx::getId, id));

// 允许: 双条件内联
xxxMapper.selectList(new LambdaQueryWrapper<Xxx>()
        .eq(Xxx::getTenantId, tenantId)
        .eq(Xxx::getStatus, 1));
```

```java
// 错误: lambdaUpdate 链式不提取
billingOrderService.lambdaUpdate().eq(BillingOrder::getId, orderId)
        .set(BillingOrder::getStatus, status)
        .update();

// 正确: 提取为变量
LambdaUpdateChainWrapper<BillingOrder> updater = billingOrderService.lambdaUpdate()
        .eq(BillingOrder::getId, orderId)
        .set(BillingOrder::getStatus, status);
updater.update();
```

**判定标准**：条件数量 ≤ 2 且不包含 `.and()` / `.or()` 嵌套，即为"入参少"，可内联。

## 循环规范

禁止使用索引下标的 for 循环（`for (int i = 0; i < N; i++)`），优先使用增强 for-each 或 Iterator：

```java
// 错误: 索引下标循环
for (int i = 0; i < items.size(); i++) {
    process(items.get(i));
}

// 正确: 增强 for-each
for (Xxx item : items) {
    process(item);
}

// 正确: forEach + lambda
items.forEach(this::process);

// 正确: 并行迭代使用 Iterator
Iterator<A> aIter = listA.iterator();
Iterator<B> bIter = listB.iterator();
while (aIter.hasNext()) {
    combine(aIter.next(), bIter.next());
}
```

## 批量写入规范

禁止在 forEach 中逐条 insert/delete，必须使用 insertBatch/batchInsert 批量操作：

```java
// 错误: 逐条 INSERT
items.forEach(item -> mapper.insert(item));

// 正确: 批量 INSERT
mapper.insertBatch(items);
```

## 文件组织

多个小文件 > 少量大文件：
- 高内聚，低耦合
- 通常 200-400 行，最多 800 行
- 从大型类中提取工具方法
- 按功能/领域组织，而非按类型组织
- 一个文件一个主要类

## 错误处理

始终全面处理错误：

```java
// 正确：全面的错误处理
public R<OrderVO> getOrder(Long orderId) {
    try {
        Order order = orderMapper.selectById(orderId);
        if (order == null) {
            throw new BusinessException(ErrorCode.ORDER_NOT_FOUND);
        }
        return Result.ok(convertToVO(order));
    } catch (ServiceException e) {
        throw e;  // 业务异常透传，由全局处理器统一处理
    } catch (Exception e) {
        log.error("查询订单失败, orderId={}", orderId, e);
        throw new BusinessException(ErrorCode.SYSTEM_ERROR);
    }
}
```

要点：
1. 使用全局异常处理器进行统一异常处理
2. 自定义异常继承 `BusinessException`
3. 错误码使用枚举类管理
4. 避免在 catch 中吞掉异常

## 输入验证

始终验证用户输入：

```java
// 正确：使用注解校验
@Data
public class OrderCreateDTO {
    @NotBlank(message = "订单号不能为空")
    @Size(max = 64)
    private String orderNo;

    @NotNull(message = "金额不能为空")
    @DecimalMin(value = "0.01", message = "金额必须大于0")
    private BigDecimal amount;

    @NotNull
    private Long userId;
}
```

## 代码质量检查清单

在标记工作完成前：
- [ ] 代码可读性好且命名规范
- [ ] 函数/方法简短（<50 行）
- [ ] 文件聚焦（<800 行）
- [ ] 无深层嵌套（>4 层）
- [ ] 正确的错误处理（使用 BusinessException 和全局处理器）
- [ ] 无 System.out.println / 调试输出（使用 Logger）
- [ ] 无硬编码值（使用常量或配置）
- [ ] 注释无文档编号、无「契约/指标/口径」类空词、不复述代码
- [ ] 业务判定在枚举内，不在常量类堆 List
- [ ] 白名单表的查询没有冗余的 tenant_id 条件
- [ ] 局部变量使用原始类型（int/long/boolean），非包装类型（Integer/Long/Boolean）
- [ ] 无内嵌链式调用（LambdaQueryWrapper/lambdaUpdate 入参多时必须提取为变量）
- [ ] 无索引下标 for 循环（`for int i = 0`），改用 Iterator 或增强 forEach
- [ ] 无无效 import


import type { PartnersCopy } from "./types";

const zh: PartnersCopy = {
  path: "/zh/partners",
  link: "合作伙伴",
  meta: {
    title: "合作伙伴 · Rook",
    description: "用您自己的品牌提供 AI 智能体：嵌入您的产品，或以白标方式销售。按客户获得持续佣金，另加您自己的加价。",
  },
  hero: {
    title: "用您自己的品牌提供 AI 智能体",
    lead: "把 Rook 嵌入您的产品，或作为您自己的平台销售。每位客户、每个月，您都有收入。",
    cta: "成为合作伙伴",
    docs: "技术文档",
  },
  modes: {
    heading: "两种合作方式",
    items: [
      {
        who: "SaaS 产品",
        title: "嵌入您的产品",
        body: "适合诊所、理发店或美容沙龙的管理系统。智能体运行在您的产品内部，并通过 MCP 连接您的数据。",
      },
      {
        who: "代理商与经销商",
        title: "白标",
        body: "适合代理商和经销商。Rook 使用您的品牌、您的域名和您的定价。",
      },
    ],
  },
  earn: {
    heading: "收益方式",
    lead: "按每位客户的订阅获得持续佣金，再加上您自己的加价。加价部分全部归您。",
    exampleLabel: "示例（仅作说明）",
    price: "客户支付",
    commission: "佣金",
    markup: "您的加价",
    total: "您的收入",
    note: "比例可按合作伙伴单独配置，此示例使用 20%。数字仅作说明，不构成合同条款。",
  },
  included: {
    heading: "开箱即用",
    items: [
      { title: "分行业智能体模板", body: "面向诊所、理发店、沙龙等，日常流程已经配置好。" },
      { title: "嵌入 SDK", body: "Rook 运行在您的产品里，使用您的登录和您的风格。" },
      { title: "合作伙伴 API", body: "用代码创建客户、设置额度并跟踪用量。" },
      { title: "问诊录音", body: "面向诊所：智能体转写问诊内容，并生成病历草稿。" },
      { title: "按客户管理额度", body: "控制每位客户的花费，需要时随时充值。" },
      { title: "Webhook", body: "额度用完或发生重要事件时第一时间通知您。" },
      { title: "数据隔离", body: "每位客户拥有独立空间，与其他客户互不相通。" },
      { title: "LGPD", body: "个人数据处理从一开始就按巴西法律设计。" },
    ],
  },
  proof: {
    heading: "已在真实产品中运行",
    body: "一系列面向诊所、理发店和沙龙的垂直产品已嵌入 Rook。智能体负责接待、预约和记录，并连接每位客户的数据。",
  },
  how: {
    heading: "如何开始",
    steps: [
      { title: "联系我们", body: "介绍您的产品和客户，我们几天内回复。" },
      { title: "配置您的模板", body: "我们一起选定智能体、额度和价格。" },
      { title: "集成", body: "用 SDK 嵌入，或上线您的白标。" },
      { title: "销售", body: "客户订阅，您每月收款。" },
    ],
  },
  faq: {
    heading: "常见问题",
    items: [
      { question: "需要会编程吗？", answer: "嵌入您的产品需要：SDK 和 API 面向您的技术团队。白标无需写代码。" },
      { question: "谁负责我客户的支持？", answer: "您在一线，我们在背后支持。首次沟通时一起约定。" },
      { question: "我客户的数据会分开存放吗？", answer: "会。每位客户都有独立空间，智能体只能访问您连接的内容。" },
      { question: "起步要花多少钱？", answer: "我们会和您商量适合您业务的模式。提交表单不产生任何承诺。" },
      { question: "可以用我自己的域名和品牌吗？", answer: "可以。白标模式下，Rook 以您的品牌、您的域名和您的定价呈现。" },
    ],
  },
  form: {
    heading: "成为合作伙伴",
    name: "姓名",
    email: "工作邮箱",
    company: "公司",
    website: "网站",
    type: "希望的合作方式",
    types: { embedded: "嵌入我的产品", white_label: "白标", unsure: "还没想好" },
    country: "国家或地区",
    customers: "客户数量",
    customerRanges: ["50 以内", "50 到 200", "200 到 1,000", "1,000 以上"],
    message: "留言",
    consent: "我同意就合作伙伴计划与我联系，并同意为此处理我的数据。",
    submit: "提交",
    successTitle: "我们已收到您的留言。",
    success: "我们已向 {email} 发送邮件，很快会回复您。",
    error: "暂时无法提交，请稍后再试。",
    requiredError: "请填写此项。",
    emailError: "请输入有效的邮箱。",
    consentError: "需要您的同意才能继续。",
  },
};

export default zh;

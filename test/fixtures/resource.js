/* ============================================================
 * test/fixtures/resource.js —— 测试用的**合成**素材表
 *
 * ⚠ 自动生成 · 请勿手改 · 重跑 tools/build-fixtures.mjs
 *
 * 结构与 tools/build-juus.py 生成的真表一致，但：
 *   · 所有立绘/头像 URL 都是 https://example.invalid/ 占位，指向不存在的主机
 *   · 只保留 smoke-test 真正点名的那十来个角色
 *   · 手机帖子/热点是手写的假内容
 *
 * 真表是从第三方角色卡里抽出来的，不随本仓库分发（见 resource/README.md）。
 * 没有真表时 tools/smoke-test.js 自动改用这份，与卡规模有关的断言会跳过。
 * ============================================================ */
window.RESOURCE = window.RESOURCE || { characters:{}, scenes:{}, defaults:{} };
Object.assign(window.RESOURCE.characters, {
 "柴郡": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "傲娇": [
     "https://example.invalid/sprite-1.png",
     "https://example.invalid/sprite-2.png",
     "https://example.invalid/sprite-3.png"
    ],
    "悲伤": [
     "https://example.invalid/sprite-4.png",
     "https://example.invalid/sprite-5.png",
     "https://example.invalid/sprite-6.png"
    ],
    "可怜哭哭": [
     "https://example.invalid/sprite-7.png",
     "https://example.invalid/sprite-8.png",
     "https://example.invalid/sprite-9.png"
    ],
    "不满": [
     "https://example.invalid/sprite-10.png"
    ],
    "面无表情": [
     "https://example.invalid/sprite-11.png",
     "https://example.invalid/sprite-12.png",
     "https://example.invalid/sprite-13.png"
    ],
    "撒娇": [
     "https://example.invalid/sprite-14.png",
     "https://example.invalid/sprite-15.png",
     "https://example.invalid/sprite-16.png",
     "https://example.invalid/sprite-17.png"
    ],
    "生气": [
     "https://example.invalid/sprite-18.png",
     "https://example.invalid/sprite-19.png",
     "https://example.invalid/sprite-20.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-21.png",
     "https://example.invalid/sprite-22.png",
     "https://example.invalid/sprite-23.png",
     "https://example.invalid/sprite-24.png",
     "https://example.invalid/sprite-25.png"
    ],
    "嫌弃厌恶": [
     "https://example.invalid/sprite-26.png",
     "https://example.invalid/sprite-27.png",
     "https://example.invalid/sprite-28.png",
     "https://example.invalid/sprite-29.png"
    ],
    "疑惑思考": [
     "https://example.invalid/sprite-30.png",
     "https://example.invalid/sprite-31.png",
     "https://example.invalid/sprite-32.png"
    ],
    "震惊": [
     "https://example.invalid/sprite-33.png",
     "https://example.invalid/sprite-34.png",
     "https://example.invalid/sprite-35.png"
    ],
    "露出胸部": [
     "https://example.invalid/sprite-36.png",
     "https://example.invalid/sprite-37.png",
     "https://example.invalid/sprite-38.png"
    ],
    "掀起裙子": [
     "https://example.invalid/sprite-39.png",
     "https://example.invalid/sprite-40.png",
     "https://example.invalid/sprite-41.png"
    ]
   }
  }
 },
 "贝尔法斯特": {
  "default_outfit": "女仆装",
  "outfits": {
   "女仆装": {
    "宠溺": [
     "https://example.invalid/sprite-52.png",
     "https://example.invalid/sprite-53.png",
     "https://example.invalid/sprite-54.png"
    ],
    "担心": [
     "https://example.invalid/sprite-55.png",
     "https://example.invalid/sprite-56.png",
     "https://example.invalid/sprite-57.png"
    ],
    "得意": [
     "https://example.invalid/sprite-58.png",
     "https://example.invalid/sprite-59.png",
     "https://example.invalid/sprite-60.png"
    ],
    "等待": [
     "https://example.invalid/sprite-61.png",
     "https://example.invalid/sprite-62.png"
    ],
    "腹黑": [
     "https://example.invalid/sprite-63.png"
    ],
    "感动": [
     "https://example.invalid/sprite-64.png",
     "https://example.invalid/sprite-65.png"
    ],
    "鼓励": [
     "https://example.invalid/sprite-66.png"
    ],
    "害怕": [
     "https://example.invalid/sprite-67.png"
    ],
    "好奇": [
     "https://example.invalid/sprite-68.png",
     "https://example.invalid/sprite-69.png"
    ],
    "坏笑": [
     "https://example.invalid/sprite-70.png",
     "https://example.invalid/sprite-71.png"
    ],
    "慌乱": [
     "https://example.invalid/sprite-72.png"
    ],
    "魅惑": [
     "https://example.invalid/sprite-73.png",
     "https://example.invalid/sprite-74.png"
    ],
    "平静": [
     "https://example.invalid/sprite-75.png",
     "https://example.invalid/sprite-76.png"
    ],
    "期待": [
     "https://example.invalid/sprite-77.png",
     "https://example.invalid/sprite-78.png",
     "https://example.invalid/sprite-79.png",
     "https://example.invalid/sprite-80.png"
    ],
    "认真": [
     "https://example.invalid/sprite-81.png",
     "https://example.invalid/sprite-82.png"
    ],
    "失落": [
     "https://example.invalid/sprite-83.png"
    ],
    "思考": [
     "https://example.invalid/sprite-84.png",
     "https://example.invalid/sprite-85.png"
    ],
    "提醒": [
     "https://example.invalid/sprite-86.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-87.png",
     "https://example.invalid/sprite-88.png",
     "https://example.invalid/sprite-89.png"
    ],
    "温柔": [
     "https://example.invalid/sprite-90.png",
     "https://example.invalid/sprite-91.png",
     "https://example.invalid/sprite-92.png"
    ],
    "无奈": [
     "https://example.invalid/sprite-93.png"
    ],
    "行礼": [
     "https://example.invalid/sprite-94.png",
     "https://example.invalid/sprite-95.png",
     "https://example.invalid/sprite-96.png"
    ],
    "兴奋": [
     "https://example.invalid/sprite-97.png"
    ],
    "邀请": [
     "https://example.invalid/sprite-98.png",
     "https://example.invalid/sprite-99.png"
    ],
    "专注": [
     "https://example.invalid/sprite-100.png"
    ],
    "发情": [
     "https://example.invalid/sprite-101.png"
    ],
    "挑逗": [
     "https://example.invalid/sprite-102.png",
     "https://example.invalid/sprite-103.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-104.png",
     "https://example.invalid/sprite-105.png"
    ]
   }
  }
 },
 "谢菲尔德": {
  "default_outfit": "女仆装",
  "outfits": {
   "女仆装": {
    "急躁": [
     "https://example.invalid/sprite-114.png"
    ],
    "犹豫": [
     "https://example.invalid/sprite-115.png",
     "https://example.invalid/sprite-116.png"
    ],
    "慌乱": [
     "https://example.invalid/sprite-117.png"
    ],
    "嫌弃脸比心": [
     "https://example.invalid/sprite-118.png",
     "https://example.invalid/sprite-119.png"
    ],
    "不满": [
     "https://example.invalid/sprite-120.png"
    ],
    "抗拒": [
     "https://example.invalid/sprite-121.png"
    ],
    "嫌弃": [
     "https://example.invalid/sprite-122.png",
     "https://example.invalid/sprite-123.png"
    ],
    "观察": [
     "https://example.invalid/sprite-124.png",
     "https://example.invalid/sprite-125.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-126.png",
     "https://example.invalid/sprite-127.png"
    ],
    "示意安静": [
     "https://example.invalid/sprite-128.png",
     "https://example.invalid/sprite-129.png"
    ],
    "行礼": [
     "https://example.invalid/sprite-130.png"
    ],
    "发呆": [
     "https://example.invalid/sprite-131.png"
    ],
    "闹别扭": [
     "https://example.invalid/sprite-132.png",
     "https://example.invalid/sprite-133.png",
     "https://example.invalid/sprite-134.png"
    ],
    "羞耻": [
     "https://example.invalid/sprite-135.png"
    ],
    "思考": [
     "https://example.invalid/sprite-136.png",
     "https://example.invalid/sprite-137.png"
    ],
    "催促": [
     "https://example.invalid/sprite-138.png"
    ],
    "生气": [
     "https://example.invalid/sprite-139.png"
    ],
    "惊讶": [
     "https://example.invalid/sprite-140.png"
    ],
    "欣赏": [
     "https://example.invalid/sprite-141.png"
    ],
    "踩踏": [
     "https://example.invalid/sprite-142.png",
     "https://example.invalid/sprite-143.png"
    ],
    "性爱勾引": [
     "https://example.invalid/sprite-144.png",
     "https://example.invalid/sprite-145.png",
     "https://example.invalid/sprite-146.png"
    ],
    "发情": [
     "https://example.invalid/sprite-147.png",
     "https://example.invalid/sprite-148.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-149.png"
    ]
   }
  }
 },
 "Z23": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "报告": [
     "https://example.invalid/sprite-157.png",
     "https://example.invalid/sprite-158.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-159.png",
     "https://example.invalid/sprite-160.png",
     "https://example.invalid/sprite-161.png"
    ],
    "可怜哭哭": [
     "https://example.invalid/sprite-162.png",
     "https://example.invalid/sprite-163.png",
     "https://example.invalid/sprite-164.png"
    ],
    "面无表情": [
     "https://example.invalid/sprite-165.png",
     "https://example.invalid/sprite-166.png",
     "https://example.invalid/sprite-167.png"
    ],
    "生气": [
     "https://example.invalid/sprite-168.png",
     "https://example.invalid/sprite-169.png",
     "https://example.invalid/sprite-170.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-171.png",
     "https://example.invalid/sprite-172.png",
     "https://example.invalid/sprite-173.png"
    ],
    "嫌弃": [
     "https://example.invalid/sprite-174.png",
     "https://example.invalid/sprite-175.png",
     "https://example.invalid/sprite-176.png"
    ],
    "疑惑": [
     "https://example.invalid/sprite-177.png",
     "https://example.invalid/sprite-178.png",
     "https://example.invalid/sprite-179.png"
    ],
    "震惊": [
     "https://example.invalid/sprite-180.png",
     "https://example.invalid/sprite-181.png"
    ],
    "露出胸部": [
     "https://example.invalid/sprite-182.png",
     "https://example.invalid/sprite-183.png",
     "https://example.invalid/sprite-184.png"
    ],
    "掀起裙子": [
     "https://example.invalid/sprite-185.png",
     "https://example.invalid/sprite-186.png",
     "https://example.invalid/sprite-187.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-188.png",
     "https://example.invalid/sprite-189.png",
     "https://example.invalid/sprite-190.png"
    ]
   }
  }
 },
 "Z52": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "傲娇": [
     "https://example.invalid/sprite-204.png",
     "https://example.invalid/sprite-205.png",
     "https://example.invalid/sprite-206.png"
    ],
    "可怜哭哭": [
     "https://example.invalid/sprite-207.png",
     "https://example.invalid/sprite-208.png",
     "https://example.invalid/sprite-209.png",
     "https://example.invalid/sprite-210.png"
    ],
    "面无表情": [
     "https://example.invalid/sprite-211.png",
     "https://example.invalid/sprite-212.png",
     "https://example.invalid/sprite-213.png"
    ],
    "生气": [
     "https://example.invalid/sprite-214.png",
     "https://example.invalid/sprite-215.png",
     "https://example.invalid/sprite-216.png"
    ],
    "嫌弃": [
     "https://example.invalid/sprite-217.png",
     "https://example.invalid/sprite-218.png",
     "https://example.invalid/sprite-219.png"
    ],
    "疑惑": [
     "https://example.invalid/sprite-220.png",
     "https://example.invalid/sprite-221.png",
     "https://example.invalid/sprite-222.png"
    ],
    "露出奶子": [
     "https://example.invalid/sprite-223.png",
     "https://example.invalid/sprite-224.png",
     "https://example.invalid/sprite-225.png"
    ],
    "露出胸部": [
     "https://example.invalid/sprite-226.png",
     "https://example.invalid/sprite-227.png",
     "https://example.invalid/sprite-228.png"
    ],
    "掀起裙子": [
     "https://example.invalid/sprite-229.png",
     "https://example.invalid/sprite-230.png",
     "https://example.invalid/sprite-231.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-232.png",
     "https://example.invalid/sprite-233.png",
     "https://example.invalid/sprite-234.png"
    ]
   }
  }
 },
 "Z9": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "害羞": [
     "https://example.invalid/sprite-237.png",
     "https://example.invalid/sprite-238.png",
     "https://example.invalid/sprite-239.png",
     "https://example.invalid/sprite-240.png"
    ],
    "可怜哭哭": [
     "https://example.invalid/sprite-241.png",
     "https://example.invalid/sprite-242.png",
     "https://example.invalid/sprite-243.png",
     "https://example.invalid/sprite-244.png"
    ],
    "面无表情": [
     "https://example.invalid/sprite-245.png",
     "https://example.invalid/sprite-246.png",
     "https://example.invalid/sprite-247.png"
    ],
    "撒娇": [
     "https://example.invalid/sprite-248.png",
     "https://example.invalid/sprite-249.png",
     "https://example.invalid/sprite-250.png"
    ],
    "生气": [
     "https://example.invalid/sprite-251.png",
     "https://example.invalid/sprite-252.png",
     "https://example.invalid/sprite-253.png",
     "https://example.invalid/sprite-254.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-255.png",
     "https://example.invalid/sprite-256.png",
     "https://example.invalid/sprite-257.png"
    ],
    "嫌弃": [
     "https://example.invalid/sprite-258.png"
    ],
    "疑惑思考": [
     "https://example.invalid/sprite-259.png",
     "https://example.invalid/sprite-260.png",
     "https://example.invalid/sprite-261.png"
    ],
    "震惊": [
     "https://example.invalid/sprite-262.png",
     "https://example.invalid/sprite-263.png",
     "https://example.invalid/sprite-264.png"
    ],
    "掀起裙子": [
     "https://example.invalid/sprite-265.png",
     "https://example.invalid/sprite-266.png",
     "https://example.invalid/sprite-267.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-268.png",
     "https://example.invalid/sprite-269.png",
     "https://example.invalid/sprite-270.png"
    ]
   }
  }
 },
 "企业": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "害羞": [
     "https://example.invalid/sprite-273.png"
    ],
    "怀疑": [
     "https://example.invalid/sprite-274.png"
    ],
    "慌乱": [
     "https://example.invalid/sprite-275.png",
     "https://example.invalid/sprite-276.png"
    ],
    "疲惫": [
     "https://example.invalid/sprite-277.png"
    ],
    "平静": [
     "https://example.invalid/sprite-278.png"
    ],
    "认同": [
     "https://example.invalid/sprite-279.png"
    ],
    "认真": [
     "https://example.invalid/sprite-280.png",
     "https://example.invalid/sprite-281.png",
     "https://example.invalid/sprite-282.png"
    ],
    "生气": [
     "https://example.invalid/sprite-283.png",
     "https://example.invalid/sprite-284.png",
     "https://example.invalid/sprite-285.png",
     "https://example.invalid/sprite-286.png"
    ],
    "思考": [
     "https://example.invalid/sprite-287.png",
     "https://example.invalid/sprite-288.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-289.png",
     "https://example.invalid/sprite-290.png",
     "https://example.invalid/sprite-291.png",
     "https://example.invalid/sprite-292.png"
    ],
    "温柔": [
     "https://example.invalid/sprite-293.png",
     "https://example.invalid/sprite-294.png",
     "https://example.invalid/sprite-295.png"
    ],
    "行军礼": [
     "https://example.invalid/sprite-296.png",
     "https://example.invalid/sprite-297.png",
     "https://example.invalid/sprite-298.png"
    ],
    "兴奋": [
     "https://example.invalid/sprite-299.png",
     "https://example.invalid/sprite-300.png"
    ],
    "邀请": [
     "https://example.invalid/sprite-301.png",
     "https://example.invalid/sprite-302.png"
    ],
    "拥抱": [
     "https://example.invalid/sprite-303.png",
     "https://example.invalid/sprite-304.png",
     "https://example.invalid/sprite-305.png"
    ],
    "慵懒": [
     "https://example.invalid/sprite-306.png"
    ],
    "自信": [
     "https://example.invalid/sprite-307.png",
     "https://example.invalid/sprite-308.png"
    ],
    "比心": [
     "https://example.invalid/sprite-309.png",
     "https://example.invalid/sprite-310.png"
    ],
    "不满": [
     "https://example.invalid/sprite-311.png",
     "https://example.invalid/sprite-312.png"
    ],
    "擦嘴巴": [
     "https://example.invalid/sprite-313.png"
    ],
    "吃军粮": [
     "https://example.invalid/sprite-314.png",
     "https://example.invalid/sprite-315.png"
    ],
    "宠溺": [
     "https://example.invalid/sprite-316.png"
    ],
    "打招呼": [
     "https://example.invalid/sprite-317.png"
    ],
    "担心": [
     "https://example.invalid/sprite-318.png",
     "https://example.invalid/sprite-319.png"
    ],
    "得意": [
     "https://example.invalid/sprite-320.png",
     "https://example.invalid/sprite-321.png"
    ],
    "发呆": [
     "https://example.invalid/sprite-322.png"
    ],
    "敷衍": [
     "https://example.invalid/sprite-323.png"
    ],
    "尴尬": [
     "https://example.invalid/sprite-324.png",
     "https://example.invalid/sprite-325.png",
     "https://example.invalid/sprite-326.png"
    ],
    "感动": [
     "https://example.invalid/sprite-327.png"
    ],
    "观察": [
     "https://example.invalid/sprite-328.png"
    ],
    "挑逗": [
     "https://example.invalid/sprite-329.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-330.png",
     "https://example.invalid/sprite-331.png",
     "https://example.invalid/sprite-332.png"
    ],
    "发情": [
     "https://example.invalid/sprite-333.png",
     "https://example.invalid/sprite-334.png"
    ]
   }
  }
 },
 "明石": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "担心": [
     "https://example.invalid/sprite-346.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-347.png"
    ],
    "惊讶": [
     "https://example.invalid/sprite-348.png"
    ],
    "开心": [
     "https://example.invalid/sprite-349.png"
    ],
    "疑惑": [
     "https://example.invalid/sprite-350.png"
    ],
    "坏笑": [
     "https://example.invalid/sprite-351.png"
    ],
    "性高潮": [
     "https://example.invalid/sprite-352.png"
    ]
   }
  }
 },
 "天狼星": {
  "default_outfit": "女仆服",
  "outfits": {
   "女仆服": {
    "笨手笨脚": [
     "https://example.invalid/sprite-359.png",
     "https://example.invalid/sprite-360.png",
     "https://example.invalid/sprite-361.png",
     "https://example.invalid/sprite-362.png"
    ],
    "不满": [
     "https://example.invalid/sprite-363.png",
     "https://example.invalid/sprite-364.png"
    ],
    "持剑得意": [
     "https://example.invalid/sprite-365.png",
     "https://example.invalid/sprite-366.png"
    ],
    "崇拜": [
     "https://example.invalid/sprite-367.png",
     "https://example.invalid/sprite-368.png",
     "https://example.invalid/sprite-369.png"
    ],
    "担心": [
     "https://example.invalid/sprite-370.png"
    ],
    "得意": [
     "https://example.invalid/sprite-371.png",
     "https://example.invalid/sprite-372.png",
     "https://example.invalid/sprite-373.png"
    ],
    "端茶": [
     "https://example.invalid/sprite-374.png",
     "https://example.invalid/sprite-375.png",
     "https://example.invalid/sprite-376.png"
    ],
    "端点心": [
     "https://example.invalid/sprite-377.png",
     "https://example.invalid/sprite-378.png"
    ],
    "恶作剧": [
     "https://example.invalid/sprite-379.png",
     "https://example.invalid/sprite-380.png"
    ],
    "发呆": [
     "https://example.invalid/sprite-381.png",
     "https://example.invalid/sprite-382.png",
     "https://example.invalid/sprite-383.png"
    ],
    "感动": [
     "https://example.invalid/sprite-384.png",
     "https://example.invalid/sprite-385.png"
    ],
    "关心": [
     "https://example.invalid/sprite-386.png"
    ],
    "观察": [
     "https://example.invalid/sprite-387.png",
     "https://example.invalid/sprite-388.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-389.png",
     "https://example.invalid/sprite-390.png"
    ],
    "好奇": [
     "https://example.invalid/sprite-391.png",
     "https://example.invalid/sprite-392.png"
    ],
    "戒备": [
     "https://example.invalid/sprite-393.png",
     "https://example.invalid/sprite-394.png",
     "https://example.invalid/sprite-395.png"
    ],
    "紧张": [
     "https://example.invalid/sprite-396.png"
    ],
    "迷糊": [
     "https://example.invalid/sprite-397.png"
    ],
    "女仆礼": [
     "https://example.invalid/sprite-398.png",
     "https://example.invalid/sprite-399.png"
    ],
    "平静": [
     "https://example.invalid/sprite-400.png"
    ],
    "期待": [
     "https://example.invalid/sprite-401.png",
     "https://example.invalid/sprite-402.png",
     "https://example.invalid/sprite-403.png"
    ],
    "请求": [
     "https://example.invalid/sprite-404.png"
    ],
    "认真": [
     "https://example.invalid/sprite-405.png",
     "https://example.invalid/sprite-406.png",
     "https://example.invalid/sprite-407.png",
     "https://example.invalid/sprite-408.png"
    ],
    "生气": [
     "https://example.invalid/sprite-409.png",
     "https://example.invalid/sprite-410.png",
     "https://example.invalid/sprite-411.png"
    ],
    "失落": [
     "https://example.invalid/sprite-412.png",
     "https://example.invalid/sprite-413.png"
    ],
    "示意安静": [
     "https://example.invalid/sprite-414.png"
    ],
    "侍寝": [
     "https://example.invalid/sprite-415.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-416.png",
     "https://example.invalid/sprite-417.png"
    ],
    "自责": [
     "https://example.invalid/sprite-418.png",
     "https://example.invalid/sprite-419.png",
     "https://example.invalid/sprite-420.png"
    ],
    "半裸端点心": [
     "https://example.invalid/sprite-421.png"
    ],
    "半裸诱惑": [
     "https://example.invalid/sprite-422.png"
    ],
    "发情": [
     "https://example.invalid/sprite-423.png",
     "https://example.invalid/sprite-424.png"
    ],
    "诱惑": [
     "https://example.invalid/sprite-425.png",
     "https://example.invalid/sprite-426.png"
    ]
   }
  }
 },
 "长门": {
  "default_outfit": "巫女服",
  "outfits": {
   "巫女服": {
    "平静": [
     "https://example.invalid/sprite-432.png"
    ],
    "微笑": [
     "https://example.invalid/sprite-433.png"
    ],
    "生气": [
     "https://example.invalid/sprite-434.png",
     "https://example.invalid/sprite-435.png"
    ],
    "困惑": [
     "https://example.invalid/sprite-436.png"
    ],
    "大笑": [
     "https://example.invalid/sprite-437.png"
    ],
    "伤心": [
     "https://example.invalid/sprite-438.png"
    ],
    "哭泣": [
     "https://example.invalid/sprite-439.png"
    ],
    "惊讶": [
     "https://example.invalid/sprite-440.png"
    ],
    "恼怒": [
     "https://example.invalid/sprite-441.png"
    ],
    "打招呼": [
     "https://example.invalid/sprite-442.png"
    ],
    "坏笑": [
     "https://example.invalid/sprite-443.png"
    ],
    "感动": [
     "https://example.invalid/sprite-444.png"
    ],
    "无奈": [
     "https://example.invalid/sprite-445.png"
    ],
    "娇嗔": [
     "https://example.invalid/sprite-446.png"
    ],
    "尴尬": [
     "https://example.invalid/sprite-447.png"
    ],
    "思考": [
     "https://example.invalid/sprite-448.png"
    ],
    "喜欢": [
     "https://example.invalid/sprite-449.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-450.png"
    ],
    "发情": [
     "https://example.invalid/sprite-451.png"
    ]
   },
   "睡衣": {
    "比心": [
     "https://example.invalid/sprite-452.png",
     "https://example.invalid/sprite-453.png"
    ],
    "比耶": [
     "https://example.invalid/sprite-454.png",
     "https://example.invalid/sprite-455.png"
    ],
    "不满": [
     "https://example.invalid/sprite-456.png",
     "https://example.invalid/sprite-457.png",
     "https://example.invalid/sprite-458.png"
    ],
    "担心": [
     "https://example.invalid/sprite-459.png"
    ],
    "尴尬": [
     "https://example.invalid/sprite-460.png",
     "https://example.invalid/sprite-461.png"
    ],
    "感动": [
     "https://example.invalid/sprite-462.png",
     "https://example.invalid/sprite-463.png"
    ],
    "感谢": [
     "https://example.invalid/sprite-464.png"
    ],
    "攻击": [
     "https://example.invalid/sprite-465.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-466.png",
     "https://example.invalid/sprite-467.png",
     "https://example.invalid/sprite-468.png",
     "https://example.invalid/sprite-469.png",
     "https://example.invalid/sprite-470.png"
    ],
    "好奇": [
     "https://example.invalid/sprite-471.png"
    ],
    "怀疑": [
     "https://example.invalid/sprite-472.png",
     "https://example.invalid/sprite-473.png"
    ],
    "慌乱": [
     "https://example.invalid/sprite-474.png",
     "https://example.invalid/sprite-475.png",
     "https://example.invalid/sprite-476.png"
    ],
    "紧张": [
     "https://example.invalid/sprite-477.png"
    ],
    "惊讶": [
     "https://example.invalid/sprite-478.png",
     "https://example.invalid/sprite-479.png",
     "https://example.invalid/sprite-480.png",
     "https://example.invalid/sprite-481.png"
    ],
    "开心": [
     "https://example.invalid/sprite-482.png"
    ],
    "懒散": [
     "https://example.invalid/sprite-483.png",
     "https://example.invalid/sprite-484.png"
    ],
    "卖萌": [
     "https://example.invalid/sprite-485.png",
     "https://example.invalid/sprite-486.png",
     "https://example.invalid/sprite-487.png",
     "https://example.invalid/sprite-488.png"
    ],
    "期待": [
     "https://example.invalid/sprite-489.png",
     "https://example.invalid/sprite-490.png",
     "https://example.invalid/sprite-491.png"
    ],
    "认真": [
     "https://example.invalid/sprite-492.png",
     "https://example.invalid/sprite-493.png"
    ],
    "撒娇": [
     "https://example.invalid/sprite-494.png"
    ],
    "伸懒腰": [
     "https://example.invalid/sprite-495.png"
    ],
    "生气": [
     "https://example.invalid/sprite-496.png",
     "https://example.invalid/sprite-497.png"
    ],
    "失落": [
     "https://example.invalid/sprite-498.png"
    ],
    "思考": [
     "https://example.invalid/sprite-499.png"
    ],
    "无奈": [
     "https://example.invalid/sprite-500.png"
    ],
    "嫌弃": [
     "https://example.invalid/sprite-501.png",
     "https://example.invalid/sprite-502.png",
     "https://example.invalid/sprite-503.png"
    ],
    "兴奋": [
     "https://example.invalid/sprite-504.png"
    ],
    "羞耻": [
     "https://example.invalid/sprite-505.png"
    ],
    "拥抱": [
     "https://example.invalid/sprite-506.png"
    ],
    "犹豫": [
     "https://example.invalid/sprite-507.png"
    ],
    "指责": [
     "https://example.invalid/sprite-508.png",
     "https://example.invalid/sprite-509.png",
     "https://example.invalid/sprite-510.png"
    ],
    "发情": [
     "https://example.invalid/sprite-511.png"
    ]
   }
  }
 },
 "雅努斯": {
  "default_outfit": "常服",
  "outfits": {
   "常服": {
    "不安": [
     "https://example.invalid/sprite-521.png"
    ],
    "好奇": [
     "https://example.invalid/sprite-522.png"
    ],
    "比心": [
     "https://example.invalid/sprite-523.png",
     "https://example.invalid/sprite-524.png"
    ],
    "伤心": [
     "https://example.invalid/sprite-525.png"
    ],
    "思考": [
     "https://example.invalid/sprite-526.png"
    ],
    "内心惊讶": [
     "https://example.invalid/sprite-527.png"
    ],
    "害羞": [
     "https://example.invalid/sprite-528.png",
     "https://example.invalid/sprite-529.png"
    ],
    "开心": [
     "https://example.invalid/sprite-530.png"
    ],
    "性邀请": [
     "https://example.invalid/sprite-531.png"
    ],
    "严肃": [
     "https://example.invalid/sprite-532.png"
    ],
    "惊讶": [
     "https://example.invalid/sprite-533.png",
     "https://example.invalid/sprite-534.png"
    ],
    "撒娇": [
     "https://example.invalid/sprite-535.png",
     "https://example.invalid/sprite-536.png"
    ],
    "发情": [
     "https://example.invalid/sprite-537.png",
     "https://example.invalid/sprite-538.png"
    ]
   }
  }
 }
});
Object.assign(window.RESOURCE.defaults, {
 "柴郡": [
  "https://example.invalid/sprite-42.png",
  "https://example.invalid/sprite-43.png",
  "https://example.invalid/sprite-44.png",
  "https://example.invalid/sprite-45.png",
  "https://example.invalid/sprite-46.png",
  "https://example.invalid/sprite-47.png"
 ],
 "雪风": [
  "https://example.invalid/sprite-48.png",
  "https://example.invalid/sprite-49.png",
  "https://example.invalid/sprite-50.png",
  "https://example.invalid/sprite-51.png"
 ],
 "贝尔法斯特": [
  "https://example.invalid/sprite-106.png",
  "https://example.invalid/sprite-107.png",
  "https://example.invalid/sprite-108.png",
  "https://example.invalid/sprite-109.png",
  "https://example.invalid/sprite-110.png",
  "https://example.invalid/sprite-111.png",
  "https://example.invalid/sprite-112.png",
  "https://example.invalid/sprite-113.png"
 ],
 "谢菲尔德": [
  "https://example.invalid/sprite-150.png",
  "https://example.invalid/sprite-151.png",
  "https://example.invalid/sprite-152.png",
  "https://example.invalid/sprite-153.png",
  "https://example.invalid/sprite-154.png",
  "https://example.invalid/sprite-155.png",
  "https://example.invalid/sprite-156.png"
 ],
 "Z23": [
  "https://example.invalid/sprite-191.png",
  "https://example.invalid/sprite-192.png",
  "https://example.invalid/sprite-193.png",
  "https://example.invalid/sprite-194.png",
  "https://example.invalid/sprite-195.png",
  "https://example.invalid/sprite-196.png",
  "https://example.invalid/sprite-197.png",
  "https://example.invalid/sprite-198.png",
  "https://example.invalid/sprite-199.png",
  "https://example.invalid/sprite-200.png",
  "https://example.invalid/sprite-201.png",
  "https://example.invalid/sprite-202.png",
  "https://example.invalid/sprite-203.png"
 ],
 "Z52": [
  "https://example.invalid/sprite-235.png",
  "https://example.invalid/sprite-236.png"
 ],
 "Z9": [
  "https://example.invalid/sprite-271.png",
  "https://example.invalid/sprite-272.png"
 ],
 "企业": [
  "https://example.invalid/sprite-335.png",
  "https://example.invalid/sprite-336.png",
  "https://example.invalid/sprite-337.png",
  "https://example.invalid/sprite-338.png",
  "https://example.invalid/sprite-339.png",
  "https://example.invalid/sprite-340.png",
  "https://example.invalid/sprite-341.png",
  "https://example.invalid/sprite-342.png",
  "https://example.invalid/sprite-343.png",
  "https://example.invalid/sprite-344.png",
  "https://example.invalid/sprite-345.png"
 ],
 "明石": [
  "https://example.invalid/sprite-353.png",
  "https://example.invalid/sprite-354.png",
  "https://example.invalid/sprite-355.png",
  "https://example.invalid/sprite-356.png",
  "https://example.invalid/sprite-357.png",
  "https://example.invalid/sprite-358.png"
 ],
 "天狼星": [
  "https://example.invalid/sprite-427.png",
  "https://example.invalid/sprite-428.png",
  "https://example.invalid/sprite-429.png",
  "https://example.invalid/sprite-430.png",
  "https://example.invalid/sprite-431.png"
 ],
 "长门": [
  "https://example.invalid/sprite-512.png",
  "https://example.invalid/sprite-513.png",
  "https://example.invalid/sprite-514.png",
  "https://example.invalid/sprite-515.png",
  "https://example.invalid/sprite-516.png",
  "https://example.invalid/sprite-517.png",
  "https://example.invalid/sprite-518.png"
 ],
 "贾维斯": [
  "https://example.invalid/sprite-519.png",
  "https://example.invalid/sprite-520.png"
 ],
 "雅努斯": [
  "https://example.invalid/sprite-539.png",
  "https://example.invalid/sprite-540.png",
  "https://example.invalid/sprite-541.png",
  "https://example.invalid/sprite-542.png",
  "https://example.invalid/sprite-543.png"
 ]
});
Object.assign(window.RESOURCE.scenes, {
 "城郊花田": [
  "https://example.invalid/sprite-544.png"
 ],
 "草原": [
  "https://example.invalid/sprite-545.png"
 ],
 "雪山": [
  "https://example.invalid/sprite-546.png"
 ],
 "小镇": [
  "https://example.invalid/sprite-547.png"
 ],
 "街区": [
  "https://example.invalid/sprite-548.png"
 ],
 "教室": [
  "https://example.invalid/sprite-549.png"
 ],
 "校园": [
  "https://example.invalid/sprite-550.png"
 ],
 "教堂": [
  "https://example.invalid/sprite-551.png"
 ],
 "公园": [
  "https://example.invalid/sprite-552.png"
 ],
 "海边": [
  "https://example.invalid/sprite-553.png"
 ],
 "海边小镇": [
  "https://example.invalid/sprite-554.png"
 ],
 "咖啡馆": [
  "https://example.invalid/sprite-555.png"
 ]
});
window.PHONE_RES = window.PHONE_RES || {};
window.PHONE_RES.stickers = {
 "躺": "https://example.invalid/sprite-556.png",
 "提不起劲": "https://example.invalid/sprite-557.png",
 "听我上课": "https://example.invalid/sprite-558.png",
 "停下来啊": "https://example.invalid/sprite-559.png",
 "通宵": "https://example.invalid/sprite-560.png",
 "突破天际": "https://example.invalid/sprite-561.png",
 "晚安": "https://example.invalid/sprite-562.png",
 "为什么 为什么": "https://example.invalid/sprite-563.png"
};
window.PHONE_RES.avatars = {
 "柴郡": "https://example.invalid/sprite-564.png",
 "雪风": "https://example.invalid/sprite-565.png",
 "贝尔法斯特": "https://example.invalid/sprite-566.png",
 "谢菲尔德": "https://example.invalid/sprite-567.png",
 "Z23": "https://example.invalid/sprite-568.png",
 "Z52": "https://example.invalid/sprite-569.png",
 "Z9": "https://example.invalid/sprite-570.png",
 "企业": "https://example.invalid/sprite-571.png",
 "明石": "https://example.invalid/sprite-572.png",
 "天狼星": "https://example.invalid/sprite-573.png",
 "长门": "https://example.invalid/sprite-574.png",
 "贾维斯": "https://example.invalid/sprite-575.png",
 "雅努斯": "https://example.invalid/sprite-576.png"
};
window.PHONE_RES.defaultAvatars = [
 "https://example.invalid/sprite-577.png",
 "https://example.invalid/sprite-578.png"
];

window.PHONE_RES.groupMeta = {
 "公共频道": { "img": "https://example.invalid/group-1.png", "members": null },
 "作战简报": { "img": "https://example.invalid/group-2.png", "members": null },
 "食堂小分队": { "img": "https://example.invalid/group-3.png", "members": ["柴郡", "Z23"] }
};
/* 下面是为测试手写的假内容，不来自任何角色卡 */
window.PHONE_RES.basePosts = [
 { "author": "Z23", "tag": "学习", "title": "今日港区小课堂",
   "likes": "1,024", "comments": 12, "stars": 88,
   "body": "今天讲的是航线规划。\n**认真听讲的**课后有小饼干。\n指挥官也来旁听了，[[青:前排就座]]。",
   "avatar": "https://example.invalid/avatar-1.png", "cmts": [] },
 { "author": "柴郡", "tag": "日常", "title": "厨房失窃案",
   "likes": "512", "comments": 7, "stars": 30,
   "body": "点心又少了一块。\n**不是我**喵。",
   "avatar": "https://example.invalid/avatar-2.png", "cmts": [] }
];
window.PHONE_RES.baseTrends = [
 { "cat": "港区新闻", "topic": "食堂今日加菜", "cnt": "排队已经绕了码头半圈。" },
 { "cat": "训练", "topic": "夜间演习改期", "cnt": "改到明天早上。" }
];
window.PHONE_RES.baseArea = [];

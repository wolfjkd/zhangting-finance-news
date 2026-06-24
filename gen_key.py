"""永久激活码生成工具"""
import sys
import os

# 确保能导入 app 模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app

print("=" * 50)
print("  永久激活码生成工具 V1.0")
print("=" * 50)

if len(sys.argv) > 1:
    # 命令行模式：传入指纹作为参数
    fingerprint = sys.argv[1].strip().upper()
else:
    # 交互模式
    fingerprint = input("\n请输入用户机器指纹：").strip().upper()

if not fingerprint:
    print("错误：指纹不能为空！")
    input("\n按回车键退出...")
    sys.exit(1)

key = app._generate_license_key(fingerprint, None)

print(f"\n机器指纹：{fingerprint}")
print(f"永久激活码：{key}")
print("\n" + "=" * 50)

input("\n按回车键退出...")

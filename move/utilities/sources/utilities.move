module apto_orm::utilities {
    use std::error;
    use std::vector;
    use std::fixed_point32::{create_from_rational, FixedPoint32};
    use std::string::{Self, String};

    const EINVALID_DECIMAL_STRING: u64 = 1;

    public fun join_str1(_de: &String, s1: &String): String {
        *s1
    }

    public fun join_str2(de: &String, s1: &String, s2: &String): String {
        let s: String = string::utf8(b"");
        string::append(&mut s, *s1);
        string::append(&mut s, *de);
        string::append(&mut s, *s2);
        s
    }

    public fun join_str3(de: &String, s1: &String, s2: &String, s3: &String): String {
        let s: String = string::utf8(b"");
        string::append(&mut s, *s1);
        string::append(&mut s, *de);
        string::append(&mut s, *s2);
        string::append(&mut s, *de);
        string::append(&mut s, *s3);
        s
    }

    inline fun is_digit(byte: u8): bool {
        byte >= 0x30 && byte <= 0x39 // byte >= b'0' && byte <= b'9'
    }

    public fun str_to_rational_number(s: &String): (u64, u64) {
        let len = string::length(s);
        let bytes = string::bytes(s);
        let num = 0u64;
        let fraction_part = false;
        let fraction_multiplier = 1u64; // denominator
        let i = 0;
        while (i < len) {
            let byte = *vector::borrow(bytes, i);
            if (byte == 0x2E) { // . = 0x2E
                fraction_part = true;
            } else {
                assert!(is_digit(byte), error::invalid_argument(EINVALID_DECIMAL_STRING));
                num = num * 10 + ((byte as u64) - 0x30u64);
                if (fraction_part) {
                    fraction_multiplier = fraction_multiplier * 10;
                }
            };
            i = i + 1;
        };
        (num, fraction_multiplier) // (numerator, denominator)
    }

    public fun str_to_fixed_point32(s: &String): FixedPoint32 {
        let (num, fraction_multiplier) = str_to_rational_number(s);
        create_from_rational(num, fraction_multiplier)
    }

    #[test]
    public entry fun test_str_to_rational_number() {
        use std::fixed_point32::get_raw_value;
        use std::fixed_point32::floor;
        // use std::fixed_point32::multiply_u64;
        use std::debug;
        let (numerator, denominator) = str_to_rational_number(&string::utf8(b"123.456"));
        assert!(denominator == 1000u64, 0x1);
        assert!(numerator == 123456u64, 0x2);
        let decimal = create_from_rational(numerator, denominator);
        debug::print<u64>(&get_raw_value(decimal));
        debug::print<u64>(&floor(decimal));
        assert!(floor(decimal) == 123u64, 0x4);
        // let xx = multiply_u64(1000, decimal);
        // debug::print<u64>(&xx);
        // assert!(multiply_u64(1000, decimal) == 123456u64, 0x3);
    }
}
module apto_orm::orm_module {
    use std::signer;
    use std::error;
    use std::vector;
    use aptos_framework::object::{Self, Object};
    use apto_orm::orm_creator::{OrmCreator};
    use apto_orm::orm_class::{OrmClass};

    const EORM_MODULE_NOT_FOUND: u64 = 1;

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    /// OrmModule recoards the ORM class type to the module
    struct OrmModule<phantom T> has key {
        signer: Object<OrmCreator>,
        class: Object<OrmClass>,
    }

    struct OrmModuleClasses<phantom T> has key, copy, drop {
        classes: vector<Object<OrmClass>>,
    }

    public fun set<T: key>(
        package: &signer, signer: address, class: address,
    ) acquires OrmModule {
        let package_address = signer::address_of(package);
        if (!exists<OrmModule<T>>(package_address)) {
            move_to(package, OrmModule<T> {
                signer: object::address_to_object<OrmCreator>(signer),
                class: object::address_to_object<OrmClass>(class),
            });
        } else {
            let orm_module = borrow_global_mut<OrmModule<T>>(package_address);
            orm_module.signer = object::address_to_object<OrmCreator>(signer);
            orm_module.class = object::address_to_object<OrmClass>(class);
        }
    }

    #[view]
    public fun get<T: key>(
        package: address
    ): (Object<OrmCreator>, Object<OrmClass>) acquires OrmModule {
        assert!(
            exists<OrmModule<T>>(package),
            error::not_found(EORM_MODULE_NOT_FOUND),
        );
        let orm_module = borrow_global<OrmModule<T>>(package);
        (orm_module.signer, orm_module.class)
    }

    public fun add_class<T: key>(package: &signer, class: address) acquires OrmModuleClasses {
        let package_address = signer::address_of(package);
        if (!exists<OrmModuleClasses<T>>(package_address)) {
            move_to(package, OrmModuleClasses<T> {
                classes: vector[object::address_to_object<OrmClass>(class)],
            });
        } else {
            let orm_module = borrow_global_mut<OrmModuleClasses<T>>(package_address);
            vector::push_back(&mut orm_module.classes, object::address_to_object<OrmClass>(class));
        }
    }

    #[view]
    public fun get_classes<T: key>(
        package: address
    ): vector<Object<OrmClass>> acquires OrmModule, OrmModuleClasses {
        if (exists<OrmModule<T>>(package)) {
            let orm_module = borrow_global<OrmModule<T>>(package);
            vector[orm_module.class]
        } else if (exists<OrmModuleClasses<T>>(package)) {
            let orm_module = borrow_global<OrmModuleClasses<T>>(package);
            orm_module.classes
        } else {
            vector[]
        }
    }
}

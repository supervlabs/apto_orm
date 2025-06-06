module apto_orm::orm_object {
    use std::signer;
    use std::error;
    use std::vector;
    use std::string::{Self, String};
    use std::option::{Self, Option};
    use aptos_framework::object::{Self, Object, ConstructorRef};
    use aptos_framework::account;
    use aptos_framework::aptos_account;
    use aptos_std::type_info;
    use aptos_framework::event;

    use aptos_token_objects::token;
    use aptos_token_objects::royalty;
    use aptos_token_objects::property_map;

    use apto_orm::orm_class::{Self, OrmClass};
    use apto_orm::orm_creator::{OrmCreator};
    use apto_orm::power_of_attorney;

    const ENOT_ORM_OBJECT: u64 = 1;
    const EORM_OBJECT_NOT_FOUND: u64 = 2;
    const EOPERATION_NOT_AUTHORIZED: u64 = 3;
    const ENOT_AUTHORIZED_CREATOR: u64 = 4;
    const EOBJECT_NOT_EXTENSIBLE: u64 = 5;
    const EOBJECT_NOT_DELETABLE: u64 = 6;
    const ENOT_ORM_TOKEN: u64 = 7;
    const ETOKEN_NOT_MUTABLE: u64 = 8;
    const ETOKEN_PROPERTY_NOT_MUTABLE: u64 = 9;
    const EOBJECT_NOT_TRANSFERABLE: u64 = 10;

    #[event]
    enum OrmEventV2 has drop, copy, store {
        DigitalAsset {
            event_type: String, // [digital_asset_mint, digital_asset_burn]
            class_address: address,
            object_address: address,
            object_type: String,
            owner_address: address,
            additional_info: String, // [created_by_fusion, burn_by_release, etc]
        }
    }

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    /// OrmObject for non-token objects
    struct OrmObject has key {
        /// The creator of the object
        creator: Object<OrmCreator>,
        /// The class of the object
        class: Object<OrmClass>,
        /// Used to add some new fields
        extend_ref: Option<object::ExtendRef>,
        /// Used for indirect-transfer_ref
        transfer_ref: Option<object::TransferRef>,
        /// Used to delete the object
        delete_ref: Option<object::DeleteRef>,
    }

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    /// OrmToken resource for handling ORM Token objects
    struct OrmToken has key {
        /// Used to burn.
        burn_ref: Option<token::BurnRef>,
        /// Used to mutate fields
        mutator_ref: Option<token::MutatorRef>,
        /// Used to mutate properties
        property_mutator_ref: Option<property_map::MutatorRef>,
        /// Used to mutate royalty
        royalty_mutator_ref: Option<royalty::MutatorRef>,
    }

    // #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    // struct OrmTokenLockup has key, drop {
    //     transfer_ref: object::TransferRef,
    //     expiration_date: u64,
    // }

    inline fun authorized_object_borrow<T: key>(object: &Object<T>, creator_or_owner: address, for_delete: bool): &OrmObject {
        let object_address = object::object_address(object);
        assert!(
            exists<OrmObject>(object_address),
            error::not_found(ENOT_ORM_OBJECT),
        );
        let orm_object = borrow_global<OrmObject>(object_address);
        let (creator_extensible, owner_extensible) = orm_class::get_extensible(orm_object.class);
        assert!(
            creator_extensible || owner_extensible,
            error::permission_denied(EOBJECT_NOT_EXTENSIBLE),
        );
        if (!for_delete) {
            let creator_authorized = creator_extensible &&
                power_of_attorney::is_authorized(&orm_object.creator, creator_or_owner);
            let owner_authorized = owner_extensible && creator_or_owner == object::owner(*object);
            assert!(
                creator_authorized || owner_authorized,
                error::permission_denied(EOPERATION_NOT_AUTHORIZED),
            );
            assert!(
                option::is_some(&orm_object.extend_ref),
                error::permission_denied(EOBJECT_NOT_EXTENSIBLE),
            );
        };
        orm_object
    }

    inline fun authorized_token_borrow<T: key>(object: &Object<T>, creator_or_owner: address): &OrmToken {
        let object_address = object::object_address(object);
        assert!(
            exists<OrmObject>(object_address),
            error::not_found(ENOT_ORM_OBJECT),
        );
        assert!(
            exists<OrmToken>(object_address),
            error::not_found(ENOT_ORM_TOKEN),
        );
        let orm_object = borrow_global<OrmObject>(object_address);
        let (
            _royalty_present,
            _token_use_property_map,
            token_mutable_by_creator,
            token_mutable_by_owner,
        ) = orm_class::get_token_config(orm_object.class);
        assert!(
            token_mutable_by_creator || token_mutable_by_owner,
            error::permission_denied(ETOKEN_NOT_MUTABLE),
        );

        let creator_authorized = token_mutable_by_creator &&
            power_of_attorney::is_authorized(&orm_object.creator, creator_or_owner);
        let owner_authorized = token_mutable_by_owner && creator_or_owner == object::owner(*object);
        assert!(
            creator_authorized || owner_authorized,
            error::permission_denied(EOPERATION_NOT_AUTHORIZED),
        );

        borrow_global<OrmToken>(object_address)
    }

    public fun init<T: key>(
        creator: &signer,
        ref: &ConstructorRef,
        class: Object<OrmClass>,
    ): signer {
        init_and_transfer<T>(
            creator,
            ref,
            class,
            option::none(),
            string::utf8(b""),
        )
    }

    public fun init_and_transfer<T: key>(
        creator: &signer,
        ref: &ConstructorRef,
        class: Object<OrmClass>,
        to: Option<address>,
        additional_info: String,
    ): signer {
        let (
            orm_creator_obj,
            _name,
            token_object,
            direct_transfer,
            deletable_by_creator,
            deletable_by_owner,
            indirect_transfer_by_creator,
            indirect_transfer_by_owner,
            extensible_by_creator,
            extensible_by_owner,
        ) = orm_class::get_object_config(class);
        assert!(
            object::object_address(&orm_creator_obj) == signer::address_of(creator),
            error::permission_denied(ENOT_AUTHORIZED_CREATOR),
        );
        // let orm_class_obj = object::convert<T, OrmClass>(class);
        let orm_object = OrmObject {
            creator: orm_creator_obj,
            class: class,
            extend_ref: option::none(),
            transfer_ref: option::none(),
            delete_ref: option::none(),
        };
        if (extensible_by_creator || extensible_by_owner) {
            orm_object.extend_ref = option::some(object::generate_extend_ref(ref));
        };
        if (deletable_by_creator || deletable_by_owner) {
            orm_object.delete_ref = if (object::can_generate_delete_ref(ref)) {
                option::some(object::generate_delete_ref(ref))
            } else {
                option::none()
            };
        };
        let transfer_ref = object::generate_transfer_ref(ref);
        if (!direct_transfer) {
            object::disable_ungated_transfer(&transfer_ref);
        };
        if (indirect_transfer_by_creator || indirect_transfer_by_owner) {
            orm_object.transfer_ref = option::some(transfer_ref);
        };

        let object_signer = object::generate_signer(ref);
        move_to(&object_signer, orm_object);
        if (token_object) {
            let (
                royalty_present,
                token_use_property_map,
                token_mutable_by_creator,
                token_mutable_by_owner,
            ) = orm_class::get_token_config(class);

            let orm_token = OrmToken {
                burn_ref: if (deletable_by_creator || deletable_by_owner) {
                    option::some(token::generate_burn_ref(ref))
                } else {
                    option::none()
                },
                mutator_ref: if (token_mutable_by_creator || token_mutable_by_owner) {
                    option::some(token::generate_mutator_ref(ref))
                } else {
                    option::none()
                },
                property_mutator_ref: if (token_use_property_map) {
                    let property_mutator_ref = property_map::generate_mutator_ref(ref);
                    option::some(property_mutator_ref)
                } else {
                    option::none()
                },
                royalty_mutator_ref: if (royalty_present) {
                    let royalty_mutator_ref = royalty::generate_mutator_ref(
                        object::generate_extend_ref(ref)
                    );
                    let royalty_option = royalty::get(class);
                    if (option::is_some(&royalty_option)) {
                        let royalty = option::extract(&mut royalty_option);
                        royalty::update(&royalty_mutator_ref, royalty);
                    };
                    option::some(royalty_mutator_ref)
                } else {
                    option::none()
                },
            };
            move_to(&object_signer, orm_token);
        };
        if (option::is_some(&to)) {
            let destination = option::extract<address>(&mut to);
            let transfer_ref = object::generate_transfer_ref(ref);
            let linear_ref = object::generate_linear_transfer_ref(&transfer_ref);
            object::transfer_with_ref(linear_ref, destination);
        };
        let object_address = object::address_from_constructor_ref(ref);
        let object = object::object_from_constructor_ref<OrmObject>(ref);
        event::emit(
            OrmEventV2::DigitalAsset {
                event_type: string::utf8(b"digital_asset_mint"),
                class_address: object::object_address(&class),
                object_address,
                object_type: type_info::type_name<T>(),
                owner_address: object::owner(object),
                additional_info: additional_info,
            },
        );
        orm_class::emit_event(class, object_address, string::utf8(b"created"));
        object_signer
    }

    public fun update<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        name: String,
        uri: String,
        description: String,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&object, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.mutator_ref),
            error::permission_denied(ETOKEN_NOT_MUTABLE),
        );
        token::set_name(option::borrow(&orm_token.mutator_ref), name);
        token::set_uri(option::borrow(&orm_token.mutator_ref), uri);
        token::set_description(option::borrow(&orm_token.mutator_ref), description);
    }

    public fun update_all_fields<T: key>(
        creator_or_owner: &signer,
        token: Object<T>,
        name: String,
        uri: String,
        description: String,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.mutator_ref),
            error::permission_denied(ETOKEN_NOT_MUTABLE),
        );
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let mutator_ref = option::borrow(&orm_token.mutator_ref);
        token::set_name(mutator_ref, name);
        token::set_uri(mutator_ref, uri);
        token::set_description(mutator_ref, description);

        let property_mutator_ref = option::borrow(&orm_token.property_mutator_ref);
        vector::enumerate_ref(&property_keys, |i, key| {
            let type = *vector::borrow(&property_types, i);
            let value = *vector::borrow(&property_values, i);
            property_map::update(property_mutator_ref, key, type, value);
        });
    }

    public fun remove<T: key>(creator_or_owner: &signer, object: Object<T>) acquires OrmObject, OrmToken {
        delete(creator_or_owner, object, string::utf8(b""))
    }

    public fun delete<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        additional_info: String
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let object_address = object::object_address(&object);
        assert!(
            exists<OrmObject>(object_address),
            error::not_found(ENOT_ORM_OBJECT),
        );
        let orm_object = move_from<OrmObject>(object_address);
        let OrmObject {creator, class, extend_ref: _, transfer_ref: _, delete_ref} = orm_object;
        let (creator_deletable, owner_deletable) = orm_class::get_deletable(class);
        assert!(
            creator_deletable || owner_deletable,
            error::permission_denied(EOBJECT_NOT_DELETABLE),
        );
        let owner_address = object::owner(object);
        let creator_authorized = creator_deletable &&
            power_of_attorney::is_authorized(&creator, creator_or_owner_address);
        let owner_authorized = owner_deletable && creator_or_owner_address == owner_address;
        assert!(
            creator_authorized || owner_authorized,
            error::permission_denied(EOPERATION_NOT_AUTHORIZED),
        );
        event::emit(
            OrmEventV2::DigitalAsset {
                event_type: string::utf8(b"digital_asset_burn"),
                class_address: object::object_address(&class),
                object_address,
                object_type: type_info::type_name<T>(),
                owner_address,
                additional_info: additional_info,
            },
        );
        if (exists<OrmToken>(object_address)) {
            let orm_token = move_from<OrmToken>(object_address);
            let OrmToken {
                burn_ref,
                mutator_ref: _,
                property_mutator_ref,
                royalty_mutator_ref: _,
            } = orm_token;
            if (option::is_some(&property_mutator_ref)) {
                let ref = option::extract(&mut property_mutator_ref);
                property_map::burn(ref);
            };
            if (option::is_some(&burn_ref)) {
                let ref = option::extract(&mut burn_ref);
                token::burn(ref);
            };
        } else if(option::is_some(&delete_ref)) {
            let ref = option::extract(&mut delete_ref);
            object::delete(ref);
        };
        orm_class::emit_event(class, object_address, string::utf8(b"deleted"));
    }

    public fun load_signer<T: key>(creator_or_owner: &signer, object: Object<T>): signer acquires OrmObject {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_object = authorized_object_borrow(&object, creator_or_owner_address, false);
        let ref = option::borrow(&orm_object.extend_ref);
        object::generate_signer_for_extending(ref)
    }

    public fun delete_and_load_signer<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        additional_info: String
    ): signer acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_object = authorized_object_borrow(&object, creator_or_owner_address, true);
        let ref = option::borrow(&orm_object.extend_ref);
        let obj_signer = object::generate_signer_for_extending(ref);
        delete<T>(creator_or_owner, object, additional_info);
        obj_signer
    }

    public entry fun set_name<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        name: String,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&object, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.mutator_ref),
            error::permission_denied(ETOKEN_NOT_MUTABLE),
        );
        token::set_name(option::borrow(&orm_token.mutator_ref), name);
    }

    public entry fun set_uri<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        uri: String,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&object, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.mutator_ref),
            error::permission_denied(ETOKEN_NOT_MUTABLE),
        );
        token::set_uri(option::borrow(&orm_token.mutator_ref), uri);
    }

    public entry fun set_description<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        description: String,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&object, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.mutator_ref),
            error::permission_denied(ETOKEN_NOT_MUTABLE),
        );
        token::set_description(option::borrow(&orm_token.mutator_ref), description);
    }

    public fun transfer_initially(ref: &ConstructorRef, to: address) {
        // create `to` account if it doesn't exists and is not an object.
        if (!object::is_object(to)) {
            if (!account::exists_at(to) && to != @0x0 && to != @0x1 && to != @0x3) {
                aptos_account::create_account(to);
            };
        };
        let transfer_ref = object::generate_transfer_ref(ref);
        let linear_ref = object::generate_linear_transfer_ref(&transfer_ref);
        object::transfer_with_ref(linear_ref, to);
    }

    /// `transfer_forcibly` - Transfer the object to the given address if
    /// the object class is configured to allow indirect transfer.
    public entry fun transfer_forcibly<T: key>(
        creator_or_owner: &signer,
        object: Object<T>,
        to: address,
    ) acquires OrmObject {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let object_address = object::object_address(&object);
        assert!(
            exists<OrmObject>(object_address),
            error::not_found(ENOT_ORM_OBJECT),
        );
        let orm_object = borrow_global<OrmObject>(object_address);
        let (creator_indirect_transfer, owner_indirect_transfer)
            = orm_class::get_indirect_transfer(orm_object.class);
        assert!(
            creator_indirect_transfer || owner_indirect_transfer,
            error::permission_denied(EOBJECT_NOT_TRANSFERABLE),
        );
        let creator_authorized = creator_indirect_transfer &&
            power_of_attorney::is_authorized(&orm_object.creator, creator_or_owner_address);
        let owner_authorized = owner_indirect_transfer && creator_or_owner_address == object::owner(object);
        assert!(
            creator_authorized || owner_authorized,
            error::permission_denied(EOPERATION_NOT_AUTHORIZED),
        );
        assert!(
            option::is_some(&orm_object.transfer_ref),
            error::permission_denied(EOBJECT_NOT_TRANSFERABLE),
        );
        let transfer_ref = option::borrow(&orm_object.transfer_ref);
        let linear_ref = object::generate_linear_transfer_ref(transfer_ref);
        object::transfer_with_ref(linear_ref, to);
    }

    public entry fun batch_transfer_forcibly(
        creator_or_owner: &signer,
        objects: vector<address>,
        to: address,
    ) acquires OrmObject {
        vector::for_each_ref(&objects, |object_address| {
            let obj = object::address_to_object<OrmToken>(*object_address);
            transfer_forcibly(creator_or_owner, obj, to);
        });
    }

    public entry fun batch_transfer_safe(
        creator_or_owner: &signer,
        objects: vector<address>,
        from: address,
        to: address,
    ) acquires OrmObject {
        vector::for_each_ref(&objects, |object_address| {
            let obj = object::address_to_object<OrmToken>(*object_address);
            assert!(
                object::owner(obj) == from,
                error::permission_denied(EOPERATION_NOT_AUTHORIZED),
            );
            transfer_forcibly(creator_or_owner, obj, to);
        });
    }

    public fun init_properties(
        ref: &ConstructorRef,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
    ) {
        let properties = property_map::prepare_input(property_keys, property_types, property_values);
        property_map::init(ref, properties);
    }

    public fun update_properties<T: key>(
        creator_or_owner: &signer,
        token: Object<T>,
        property_keys: vector<String>,
        property_types: vector<String>,
        property_values: vector<vector<u8>>,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.property_mutator_ref);
        vector::enumerate_ref(&property_keys, |i, key| {
            let type = *vector::borrow(&property_types, i);
            let value = *vector::borrow(&property_values, i);
            property_map::update(ref, key, type, value);
        });
    }

    public entry fun add_property<T: key>(
        creator_or_owner: &signer,
        token: Object<T>,
        key: String,
        type: String,
        value: vector<u8>,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.property_mutator_ref);
        property_map::add(ref, key, type, value);
    }

    public entry fun add_typed_property<T: key, V: drop>(
        creator_or_owner: &signer,
        token: Object<T>,
        key: String,
        value: V,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.property_mutator_ref);
        property_map::add_typed(ref, key, value);
    }

    public entry fun remove_property<T: key>(
        creator_or_owner: &signer,
        token: Object<T>,
        key: String,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.property_mutator_ref);
        property_map::remove(ref, &key);
    }

    public entry fun update_property<T: key>(
        creator_or_owner: &signer,
        token: Object<T>,
        key: String,
        type: String,
        value: vector<u8>,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.property_mutator_ref);
        property_map::update(ref, &key, type, value);
    }

    public entry fun update_typed_property<T: key, V: drop>(
        creator_or_owner: &signer,
        token: Object<T>,
        key: String,
        value: V,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.property_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.property_mutator_ref);
        property_map::update_typed(ref, &key, value);
    }

    public entry fun transfer_coins<T: key, CoinType>(
        creator_or_owner: &signer,
        from: Object<T>,
        to: address, amount: u64,
    ) acquires OrmObject {
        let objec_signer = load_signer(creator_or_owner, from);
        aptos_account::transfer_coins<CoinType>(&objec_signer, to, amount);
    }

    public entry fun set_royalty<T: key>(
        creator_or_owner: &signer,
        token: Object<T>,
        payee: address,
        denominator: u64,
        numerator: u64,
    ) acquires OrmObject, OrmToken {
        let creator_or_owner_address = signer::address_of(creator_or_owner);
        let orm_token = authorized_token_borrow(&token, creator_or_owner_address);
        assert!(
            option::is_some(&orm_token.royalty_mutator_ref),
            error::permission_denied(ETOKEN_PROPERTY_NOT_MUTABLE),
        );
        let ref = option::borrow(&orm_token.royalty_mutator_ref);

        let r = royalty::create(numerator, denominator, payee);
        royalty::update(ref, r);
    }

    public entry fun batch_set_royalty(
        creator_or_owner: &signer,
        tokens: vector<address>,
        payee: address,
        denominator: u64,
        numerator: u64,
    ) acquires OrmObject, OrmToken {
        vector::for_each_ref(&tokens, |token| {
            let t = object::address_to_object<OrmToken>(*token);
            set_royalty(creator_or_owner, t, payee, denominator, numerator);
        });
    }

    #[view]
    public fun get<T: key>(object: Object<T>): (
        Object<OrmCreator>, Object<OrmClass>
    ) acquires OrmObject {
        let object_address = object::object_address(&object);
        assert!(
            exists<OrmObject>(object_address),
            error::not_found(ENOT_ORM_OBJECT),
        );
        let orm_object = borrow_global<OrmObject>(object_address);
        (orm_object.creator, orm_object.class)
    }
}
